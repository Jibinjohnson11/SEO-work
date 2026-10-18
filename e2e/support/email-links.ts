import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PRODUCTION_PROJECT_REF, RUN } from "./target"

// Real emailed links for STAGING tests, collected by hand from the Resend dashboard (the staging
// Resend key can send but not read). A one-time token in such a link is a credential, so:
//   * the link is handed over through a private file outside the repository and deleted on read;
//   * it is never printed: logs show only its shape (host, path, type, token length);
//   * before anything opens it, its shape is checked AND a read-only database lookup confirms the
//     token belongs to the expected disposable account, is of the expected kind and is fresh, so a
//     token for any other account (e.g. a real pending invitation) can never be used;
//   * errors raised while the token is in play are redacted (see withTokenRedacted).

export type LinkType = "invite" | "recovery"
export type EmailLink = { href: string; token: string; type: LinkType }

const ALLOWED_ORIGIN = "http://localhost:3100"
const NEXT_PATH = "/auth/set-password"
// Supabase leaves auth.one_time_tokens.expires_at empty and applies the project's email link lifetime
// (Authentication → Email → "Email OTP expiration", default 3600 s). When expires_at is set it wins;
// otherwise a token older than this is treated as expired. Opening an expired link only fails safely.
const MAX_TOKEN_AGE_MINUTES = Number(process.env.E2E_TOKEN_MAX_AGE_MINUTES || 60)
const TOKEN_TYPE: Record<LinkType, string> = { invite: "confirmation_token", recovery: "recovery_token" }

/** Replaces every occurrence of the token (raw or URL-encoded) with [token]. */
export function redact(text: string, token: string) {
  if (!token) return text
  return text.split(token).join("[token]").split(encodeURIComponent(token)).join("[token]")
}

/** Runs fn and rethrows any failure with the token removed from its message and stack. */
export async function withTokenRedacted<T>(token: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const e = error as Error
    const clean = new Error(redact(e?.message ?? String(error), token))
    clean.stack = redact(e?.stack ?? "", token)
    throw clean
  }
}

function describeLink(url: URL, token: string) {
  return `${url.origin}${url.pathname} type=${url.searchParams.get("type")} next=${url.searchParams.get("next")} token=[${token.length} chars]`
}

const LINK_IN_TEXT = /http:\/\/localhost:3100\/auth\/confirm\?[^\s"'<>]+/

/** Without revealing it: how long the text is and what it starts with (never beyond the URL path). */
export function describeInput(raw: string) {
  const t = raw.trim()
  const kind = t.startsWith("http://localhost:3100/auth/confirm") ? "starts with the expected link address" : /^https?:\/\//.test(t) ? `starts with ${t.slice(0, t.indexOf("/", 8) + 1 || 30).slice(0, 40)}` : "is not a link"
  return `${t.length} characters, ${kind}`
}

/**
 * Checks a link's shape without opening it: exactly http://localhost:3100/auth/confirm with
 * token_hash, the expected type and next=/auth/set-password, and nothing else. If the text holds
 * more than the link (e.g. copied HTML), the first LinkOps confirm link inside it is used.
 */
export function parseEmailLink(raw: string, expected: LinkType): EmailLink {
  const decoded = raw.trim().replace(/&amp;/g, "&")
  const text = LINK_IN_TEXT.exec(decoded)?.[0] ?? decoded
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error(`The supplied text is not a URL (${describeInput(decoded)}). Copy the button's link address from the email.`)
  }
  const token = url.searchParams.get("token_hash") ?? ""
  const problems: string[] = []
  if (url.protocol !== "http:" || url.host !== "localhost:3100" || url.origin !== ALLOWED_ORIGIN)
    problems.push(`origin is ${url.protocol}//${url.host}, expected ${ALLOWED_ORIGIN} (check the staging Site URL, or a click-tracking redirect)`)
  if (url.pathname !== "/auth/confirm") problems.push(`path is ${url.pathname}, expected /auth/confirm`)
  if (url.username || url.password || url.hash) problems.push("link has credentials or a #fragment")
  const keys = [...url.searchParams.keys()].sort()
  if (keys.join(",") !== "next,token_hash,type") problems.push(`parameters are [${keys.join(", ")}], expected exactly next, token_hash, type`)
  if (url.searchParams.getAll("token_hash").length !== 1) problems.push("token_hash must appear exactly once")
  if (url.searchParams.get("type") !== expected) problems.push(`type is ${url.searchParams.get("type")}, expected ${expected}`)
  if (url.searchParams.get("next") !== NEXT_PATH) problems.push(`next is ${url.searchParams.get("next")}, expected ${NEXT_PATH}`)
  if (!/^(pkce_)?[A-Za-z0-9_-]{20,128}$/.test(token)) problems.push(`token_hash is missing or malformed (${token.length} chars)`)
  if (problems.length) throw new Error(redact(`Refusing the ${expected} link before opening it: ${problems.join("; ")}`, token))
  return { href: url.href, token, type: expected }
}

/** Reads the macOS clipboard into memory (never logged). Returns "" elsewhere or on error. */
function readClipboard(): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile("pbpaste", [], { timeout: 5_000, maxBuffer: 64 * 1024 }, (error, stdout) => resolve(error ? "" : String(stdout)))
    } catch {
      resolve("")
    }
  })
}

/** The clipboard is watched only on a real staging run on macOS (never in unit tests); E2E_LINK_CLIPBOARD=0 turns it off. */
const watchClipboard = () => process.platform === "darwin" && process.env.E2E_TARGET === "staging" && process.env.E2E_LINK_CLIPBOARD !== "0"

/**
 * Pauses until the person running the test hands over the emailed link, by either:
 *   * copying the button's link address: the clipboard is checked every second and only a
 *     http://localhost:3100/auth/confirm link of the expected type is taken (anything else on the
 *     clipboard is ignored and never read beyond that check, logged or kept); or
 *   * the typed fallback ./scripts/e2e-save-link.sh, which validates the clipboard and writes the
 *     link into this private folder.
 * Every candidate must also pass `verify` (the read-only ownership lookup) before it is accepted; a
 * link for another account or an old run is refused, the clipboard is cleared, and waiting goes on.
 * Nothing is ever opened here. Only the recipient and the link's shape are printed.
 */
export async function collectLinkManually(opts: { label: string; recipient: string; type: LinkType; timeoutMs?: number; verify?: (link: EmailLink) => Promise<void> }): Promise<EmailLink> {
  const dir = join(tmpdir(), `linkops-e2e-links-${RUN}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if ((statSync(dir).mode & 0o077) !== 0) throw new Error(`${dir} must be private (mode 700)`)
  const file = join(dir, `${opts.label}.url`)
  rmSync(file, { force: true })
  writeFileSync(join(dir, "WAITING"), `${opts.label}\n`, { mode: 0o600 }) // tells e2e-save-link.sh where to write
  const what = opts.type === "invite" ? "invitation" : "password reset"
  const button = opts.type === "invite" ? "Accept invitation" : "Choose a new password"
  const timeoutMs = opts.timeoutMs ?? 600_000
  const clipboard = watchClipboard()
  process.stdout.write(
    [
      "",
      `──── ACTION NEEDED: real ${what} link ────`,
      `1. Resend dashboard → Emails → open the ${what} email sent to:`,
      `     ${opts.recipient}`,
      `2. Right-click "${button}" → Copy Link Address (Safari: Copy Link). Do NOT open the link.`,
      clipboard
        ? `3. That's all: the test picks the link up from the clipboard within a second.`
        : `3. Then TYPE (do not copy) in Terminal:  ./scripts/e2e-save-link.sh`,
      clipboard ? `   (Backup only if nothing happens: TYPE in Terminal  ./scripts/e2e-save-link.sh )` : "",
      `The link is checked before use, never printed, and the clipboard is cleared. Waiting up to ${Math.round(timeoutMs / 60_000)} min…`,
      "",
    ].filter(Boolean).join("\n"),
  )

  /** Validates and verifies a candidate; returns it, or null to keep waiting. Throws only on a hard failure. */
  const consider = async (raw: string, source: string): Promise<EmailLink | null> => {
    let link: EmailLink
    try {
      link = parseEmailLink(raw, opts.type)
    } catch (e) {
      process.stdout.write(`Ignored the ${source}: ${(e as Error).message} Still waiting…\n`)
      return null
    }
    clearClipboard()
    try {
      await opts.verify?.(link)
    } catch (e) {
      process.stdout.write(`${redact((e as Error).message, link.token)} Still waiting for this run's ${what} link…\n`)
      return null
    }
    process.stdout.write(`Received the ${what} link (${source}): ${describeLink(new URL(link.href), link.token)}\n`)
    return link
  }

  const deadline = Date.now() + timeoutMs
  let lastRefused = ""
  try {
    while (Date.now() < deadline) {
      if (existsSync(file) && statSync(file).size > 0) {
        await new Promise((r) => setTimeout(r, 300)) // let the script finish writing
        const size = statSync(file).size
        const raw = size <= 4096 ? readFileSync(file, "utf8") : ""
        unlinkSync(file)
        if (!raw) process.stdout.write("Ignored the saved file: larger than 4 KB. Still waiting…\n")
        else {
          const link = await consider(raw, "saved file")
          if (link) return link
        }
      }
      if (clipboard) {
        const text = await readClipboard()
        // Only text that already looks like a LinkOps confirm link of this type is considered at all.
        const candidate = LINK_IN_TEXT.exec(text.replace(/&amp;/g, "&"))?.[0]
        if (candidate && new URL(candidate).searchParams.get("type") === opts.type && candidate !== lastRefused) {
          const link = await consider(candidate, "clipboard")
          if (link) return link
          lastRefused = candidate // do not re-check the same refused link every second
        }
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`No valid ${what} link for this run was supplied within the time limit`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Best effort (macOS): the link was copied to the clipboard; empty it once it has been read. */
function clearClipboard() {
  if (process.platform !== "darwin" || process.env.E2E_TARGET !== "staging") return // only during a real run
  try {
    execFile("pbcopy", [], () => {}).stdin?.end("")
  } catch {
    // not fatal: the token is single-use and is spent by the test
  }
}

const PSQL = process.env.E2E_PSQL || "/Applications/Postgres.app/Contents/Versions/17/bin/psql"

/** Read-only query against the STAGING database; the token reaches psql via the environment, not argv. */
function readOnlyQuery(sql: string, vars: Record<string, string>): Promise<string> {
  const dbUrl = process.env.STAGING_DB_URL ?? ""
  const supabaseRef = new URL(process.env.E2E_SUPABASE_URL ?? "http://invalid").hostname.split(".")[0]
  if (!dbUrl) throw new Error("STAGING_DB_URL is required for the token ownership check (run through scripts/staging-env.mjs)")
  if (dbUrl.includes(PRODUCTION_PROJECT_REF) || supabaseRef === PRODUCTION_PROJECT_REF) throw new Error("Refusing a token lookup against PRODUCTION")
  const u = new URL(dbUrl)
  if (decodeURIComponent(u.username) !== `postgres.${supabaseRef}`) throw new Error("STAGING_DB_URL is not for the staging project under test")
  // Only what psql needs: the database connection (staging) and the lookup variables.
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1) || "postgres",
    PGSSLMODE: "require",
    PGAPPNAME: "linkops-e2e-token-check",
    PGCONNECT_TIMEOUT: "20",
    ...vars,
  }
  return new Promise((resolve, reject) => {
    const child = execFile(PSQL, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], { env, timeout: 60_000 }, (error, stdout, stderr) => {
      const token = vars.LINKOPS_TOKEN_HASH ?? ""
      if (error) reject(new Error(redact(`token ownership lookup failed: ${stderr || error.message}`, token)))
      else resolve(stdout.trim())
    })
    child.stdin?.end(sql)
  })
}

/**
 * Confirms, read-only, that the link's token belongs to exactly this account, is the expected kind
 * (invitation or recovery) and was issued within the link lifetime. Nothing is consumed or changed.
 */
export async function assertTokenBelongsTo(link: EmailLink, account: { id: string; email: string }) {
  const sql = `
set default_transaction_read_only = on;
begin read only;
\\getenv h LINKOPS_TOKEN_HASH
\\getenv mins LINKOPS_TOKEN_MAX_AGE
select json_build_object(
  'matches', count(*),
  'owners', coalesce(json_agg(distinct m.user_id), '[]'),
  'types', coalesce(json_agg(distinct m.token_type), '[]'),
  'relates_to', coalesce(json_agg(distinct lower(m.relates_to)), '[]'),
  'fresh', coalesce(bool_and(m.fresh), false)
)
from (
  select ott.user_id::text, ott.token_type::text, ott.relates_to,
         (case when ott.expires_at is not null then ott.expires_at > now()
               else ott.created_at > (now() at time zone 'utc') - make_interval(mins => :'mins'::int) end) as fresh
  from auth.one_time_tokens ott
  where ott.token_hash in (:'h', regexp_replace(:'h', '^pkce_', ''), 'pkce_' || regexp_replace(:'h', '^pkce_', ''))
) m;
rollback;`
  const out = await readOnlyQuery(sql, { LINKOPS_TOKEN_HASH: link.token, LINKOPS_TOKEN_MAX_AGE: String(MAX_TOKEN_AGE_MINUTES) })
  const line = out.split("\n").reverse().find((l) => l.startsWith("{"))
  if (!line) throw new Error("token ownership lookup returned no result")
  const r = JSON.parse(line) as { matches: number; owners: string[]; types: string[]; relates_to: string[]; fresh: boolean }
  const problems: string[] = []
  if (r.matches !== 1) problems.push(`${r.matches} matching tokens (expected exactly 1)`)
  if (r.owners.length !== 1 || r.owners[0] !== account.id) problems.push("the token does NOT belong to this run's disposable account")
  if (r.types.length !== 1 || r.types[0] !== TOKEN_TYPE[link.type]) problems.push(`token kind is ${r.types.join("/") || "none"}, expected ${TOKEN_TYPE[link.type]}`)
  if (r.relates_to.length && !r.relates_to.includes(account.email.toLowerCase())) problems.push("the token was issued for a different address")
  if (!r.fresh) problems.push(`the token has expired (past expires_at, or older than ${MAX_TOKEN_AGE_MINUTES} minutes)`)
  if (problems.length) throw new Error(`Refusing to open the ${link.type} link: ${problems.join("; ")}. Nothing was consumed.`)
}
