#!/usr/bin/env node
// Staging-only environment loader. Runs a command with the settings from .env.e2e and makes sure
// NOTHING from production can leak in:
//   * every staging value is checked: no production project reference, no value copied from
//     .env.local, keys of the right type for the staging project;
//   * every variable name defined in .env.local (and other .env files Next.js loads) is set
//     explicitly, to the staging value or to "", so Next.js cannot fall back to a production value
//     (values already in the environment always win over .env files);
//   * builds go to .next-staging, never mixing with the production build in .next.
//
//   node scripts/staging-env.mjs --check            validate only (prints checks, never values)
//   node scripts/staging-env.mjs -- <command...>     run a command in the staging environment
//
// STAGING_ENV_FILE overrides the file (default .env.e2e).
import { existsSync, readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export const PRODUCTION_REFS = ["zyrsaxndmamjjayqihdm"]
export const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL", "CRON_SECRET"]
/** .env files Next.js may load for build/start, besides the staging file itself. */
export const NEXT_ENV_FILES = [".env.local", ".env.production.local", ".env.production", ".env"]
/** Staging may email only these recipients unless .env.e2e names others (src/lib/email-allowlist.ts). */
export const DEFAULT_EMAIL_ALLOWLIST = "@resend.dev"

/** Minimal dotenv parser: KEY=VALUE lines, optional surrounding quotes, # comments. */
export function parseEnvFile(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}

function refFromUrl(url) {
  try {
    return new URL(url).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null
  } catch {
    return null
  }
}

function jwtRef(key) {
  const parts = (key ?? "").split(".")
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).ref ?? null
  } catch {
    return null
  }
}

/**
 * Builds the environment for a staging command.
 * @param {{ staging: Record<string,string>, production: Record<string,string>[], productionRefs?: string[] }} input
 * @returns {{ env: Record<string,string>, errors: string[], ref: string | null }}
 */
export function buildStagingEnv({ staging, production, productionRefs = PRODUCTION_REFS }) {
  const errors = []
  const prodRefs = new Set(productionRefs)
  for (const p of production) {
    const r = refFromUrl(p.NEXT_PUBLIC_SUPABASE_URL ?? "")
    if (r) prodRefs.add(r)
  }
  for (const k of REQUIRED) if (!staging[k]) errors.push(`${k} is missing or empty`)

  const ref = refFromUrl(staging.NEXT_PUBLIC_SUPABASE_URL ?? "")
  if (staging.NEXT_PUBLIC_SUPABASE_URL && !(ref && /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(staging.NEXT_PUBLIC_SUPABASE_URL)))
    errors.push("NEXT_PUBLIC_SUPABASE_URL must be exactly https://<20-character-ref>.supabase.co")
  if (ref && prodRefs.has(ref)) errors.push("NEXT_PUBLIC_SUPABASE_URL is the PRODUCTION project")

  // No staging value may mention a production project or repeat a production value.
  const prodValues = new Set(production.flatMap((p) => Object.values(p)).filter((v) => v && v.length >= 16))
  for (const [k, v] of Object.entries(staging)) {
    if (!v) continue
    for (const r of prodRefs) if (v.includes(r)) errors.push(`${k} refers to the PRODUCTION project`)
    if (prodValues.has(v)) errors.push(`${k} is identical to a production value from .env.local`)
  }

  const pub = staging.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  const sec = staging.SUPABASE_SERVICE_ROLE_KEY ?? ""
  if (pub && !pub.startsWith("sb_publishable_") && !(jwtRef(pub) && jwtRef(pub) === ref)) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is not a publishable key for the staging project")
  if (sec && !sec.startsWith("sb_secret_") && !(jwtRef(sec) && jwtRef(sec) === ref)) errors.push("SUPABASE_SERVICE_ROLE_KEY is not a secret key for the staging project")
  for (const [k, v] of [["NEXT_PUBLIC_SUPABASE_ANON_KEY", pub], ["SUPABASE_SERVICE_ROLE_KEY", sec]]) {
    const r = jwtRef(v)
    if (r && prodRefs.has(r)) errors.push(`${k} is a PRODUCTION key`)
  }

  // Email: staging always runs with a recipient allowlist, so it cannot reach a real client.
  const allow = (staging.EMAIL_ALLOWED_RECIPIENTS ?? "").trim() || DEFAULT_EMAIL_ALLOWLIST
  for (const entry of allow.split(/[\s,]+/).filter(Boolean))
    if (!/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(entry) && !/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(entry))
      errors.push(`EMAIL_ALLOWED_RECIPIENTS entry "${entry}" must be @domain or a full address (no wildcards)`)
  if (staging.RESEND_API_KEY && !staging.EMAIL_FROM) errors.push("EMAIL_FROM is required when RESEND_API_KEY is set")

  if (staging.STAGING_DB_URL) {
    let u = null
    try {
      u = new URL(staging.STAGING_DB_URL)
    } catch {
      errors.push("STAGING_DB_URL is not a valid connection string (special characters in the password must be percent-encoded)")
    }
    const rawPw = staging.STAGING_DB_URL.match(/^[^:]+:\/\/[^:]+:(.*)@[^@]+$/)?.[1] ?? ""
    if (u && ref && u.username !== `postgres.${ref}`) errors.push("STAGING_DB_URL is for a different project than NEXT_PUBLIC_SUPABASE_URL")
    if (/^\[.*\]$/.test(rawPw) || /YOUR-PASSWORD/i.test(rawPw)) errors.push("STAGING_DB_URL password is still wrapped in [ ] (remove the brackets)")
    if (/[@#?/:\s[\]]/.test(rawPw.replace(/^\[|\]$/g, "")) || /%(?![0-9A-Fa-f]{2})/.test(rawPw)) errors.push("STAGING_DB_URL password has characters that must be percent-encoded")
  }

  // Shadow every production variable name so .env files cannot supply it, then apply staging values.
  const env = {}
  for (const p of production) for (const k of Object.keys(p)) env[k] = ""
  Object.assign(env, staging)
  env.E2E_TARGET = "staging"
  env.E2E_SUPABASE_URL = staging.NEXT_PUBLIC_SUPABASE_URL ?? ""
  env.E2E_SUPABASE_SECRET_KEY = staging.SUPABASE_SERVICE_ROLE_KEY ?? ""
  env.E2E_BASE_URL = staging.E2E_BASE_URL || staging.NEXT_PUBLIC_APP_URL || "http://localhost:3100"
  env.NEXT_DIST_DIR = ".next-staging"
  env.LINKOPS_ENVIRONMENT = "staging"
  env.EMAIL_ALLOWED_RECIPIENTS = allow
  return { env, errors: [...new Set(errors)], ref }
}

function load(cwd = process.cwd()) {
  const file = process.env.STAGING_ENV_FILE ?? ".env.e2e"
  const path = resolve(cwd, file)
  if (!existsSync(path)) return { file, errors: [`${file} not found`] }
  const staging = parseEnvFile(readFileSync(path, "utf8"))
  const production = NEXT_ENV_FILES.map((f) => resolve(cwd, f)).filter((f) => f !== path && existsSync(f)).map((f) => parseEnvFile(readFileSync(f, "utf8")))
  return { file, ...buildStagingEnv({ staging, production }) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const { file, env, errors, ref } = load()
  if (errors.length) {
    console.error(`[staging-env] refusing to continue (${file ?? ".env.e2e"}):`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(2)
  }
  if (args[0] === "--check") {
    console.log(`[staging-env] OK: ${file} targets staging project ${ref}; ${Object.keys(env).length} variables set, production values shadowed`)
    process.exit(0)
  }
  const sep = args.indexOf("--")
  const cmd = sep === -1 ? args : args.slice(sep + 1)
  if (!cmd.length) {
    console.error("usage: node scripts/staging-env.mjs --check | -- <command...>")
    process.exit(2)
  }
  // Start from the current environment but drop anything that could point at a database.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG[A-Z]+$/.test(k)))
  console.error(`[staging-env] staging project ${ref} — running: ${cmd.join(" ")}`)
  const child = spawn(cmd[0], cmd.slice(1), { stdio: "inherit", env: { ...base, ...env } })
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)))
}
