import { expect, type APIRequestContext, type Page } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/** The production Supabase project. Write tests must never run against it. */
export const PRODUCTION_PROJECT_REF = "zyrsaxndmamjjayqihdm"

/**
 * Write tests run only when ALL of these hold:
 *   E2E_TARGET=staging, E2E_SUPABASE_URL + E2E_SUPABASE_SECRET_KEY point at a non-production project,
 *   and the app under test is itself wired to that same project (checked from its CSP header).
 */
export function writesConfigured() {
  return process.env.E2E_TARGET === "staging"
}

let verifiedStaging = false

export async function assertStagingTarget(request: APIRequestContext) {
  const url = process.env.E2E_SUPABASE_URL ?? ""
  const key = process.env.E2E_SUPABASE_SECRET_KEY ?? ""
  if (!url || !key) throw new Error("E2E_SUPABASE_URL and E2E_SUPABASE_SECRET_KEY are required for write tests")
  const origin = new URL(url).origin
  if (origin.includes(PRODUCTION_PROJECT_REF)) throw new Error("Refusing to run write tests: E2E_SUPABASE_URL is the PRODUCTION project")
  // The app's CSP lists the Supabase origin it was built for; it must be the staging project.
  const csp = (await request.get("/login")).headers()["content-security-policy"] ?? ""
  if (csp.includes(PRODUCTION_PROJECT_REF)) throw new Error("Refusing to run write tests: the app under test is configured for PRODUCTION")
  if (!csp.includes(origin)) throw new Error(`The app under test is not configured for ${origin} (check its NEXT_PUBLIC_SUPABASE_URL)`)
  verifiedStaging = true
}

let adminClient: SupabaseClient | null = null
/**
 * Service-role client for the STAGING project (test setup only). It cannot be created until
 * assertStagingTarget() has passed in this worker, so no hook order can write to production.
 */
export function admin() {
  if (!verifiedStaging) throw new Error("Refusing to create a service-role client: the staging target has not been verified")
  adminClient ??= createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return adminClient
}

export const RUN = Date.now().toString(36)
/**
 * Unique address per test user. Defaults to Resend's test inbox (delivered+label@resend.dev), which
 * accepts mail without hurting sender reputation when staging uses Resend SMTP.
 */
export function testEmail(label: string) {
  const local = process.env.E2E_EMAIL_LOCAL ?? "delivered"
  const domain = process.env.E2E_EMAIL_DOMAIN ?? "resend.dev"
  return `${local}+linkops-${RUN}-${label}@${domain}`.toLowerCase()
}
export const PASSWORD = "E2e-Test-Password-2026"

function fail(what: string, error: { message: string } | null | undefined): never {
  throw new Error(`${what}: ${error?.message ?? "no data returned"}`)
}

/** An active, confirmed user created the way the bootstrap / approval flows leave one. */
export async function createActiveUser(role: "super_admin" | "intern" | "client", label: string, extra: { clientId?: string; campaignIds?: string[] } = {}) {
  const email = testEmail(label)
  const created = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, app_metadata: { role }, user_metadata: { full_name: `E2E ${label}` } })
  if (created.error || !created.data.user) fail("create auth user", created.error)
  const id = created.data.user.id
  const profile = await admin().from("profiles").insert({ id, email, full_name: `E2E ${label}`, role, status: "active" })
  if (profile.error) fail("create profile", profile.error)
  if (role === "client" && extra.clientId) {
    const m = await admin().from("client_members").insert({ client_id: extra.clientId, user_id: id })
    if (m.error) fail("add client member", m.error)
  }
  for (const c of extra.campaignIds ?? []) {
    const a = await admin().from("intern_assignments").insert({ campaign_id: c, intern_id: id })
    if (a.error) fail("assign intern", a.error)
  }
  return { id, email }
}

/** A client workspace with one active campaign. */
export async function createWorkspace(label: string) {
  const client = await admin().from("clients").insert({ company_name: `E2E ${label} ${RUN}`, website_url: "https://client.example.com" }).select("id").single()
  if (client.error || !client.data) fail("create client", client.error)
  const campaign = await admin()
    .from("campaigns")
    .insert({ name: `E2E campaign ${RUN}`, client_id: client.data.id, status: "active", target_url: "https://client.example.com/target" })
    .select("id")
    .single()
  if (campaign.error || !campaign.data) fail("create campaign", campaign.error)
  return { clientId: client.data.id as string, campaignId: campaign.data.id as string }
}

/**
 * The one-time link Supabase would email, generated without sending anything. Returns the app path
 * the email template points at (/auth/confirm?token_hash=…&type=…).
 */
export async function emailLinkPath(kind: "signup" | "invite" | "recovery", email: string, password?: string) {
  const res =
    kind === "signup"
      ? await admin().auth.admin.generateLink({ type: "signup", email, password: password ?? PASSWORD })
      : await admin().auth.admin.generateLink({ type: kind, email })
  if (res.error || !res.data.properties) fail(`generate ${kind} link`, res.error)
  const type = kind === "signup" ? "email" : kind // matches supabase/templates/*.html
  return `/auth/confirm?token_hash=${encodeURIComponent(res.data.properties.hashed_token)}&type=${type}`
}

/**
 * A Supabase client signed in as a real (staging) user with the PUBLIC key — the same permission
 * checks the app applies. Used for setup steps the UI tests already cover (e.g. creating submissions).
 */
export async function userClient(email: string, password = PASSWORD) {
  if (!verifiedStaging) throw new Error("Refusing to sign in: the staging target has not been verified")
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  if (!publishable) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY (staging publishable key) is required")
  const client = createClient(process.env.E2E_SUPABASE_URL!, publishable, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) fail(`sign in ${email}`, error)
  return client
}

/** The Supabase Auth record for an address (staging), e.g. to read confirmation_sent_at / invited_at / recovery_sent_at. */
export async function authUser(email: string) {
  const { data, error } = await admin().auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) fail("list auth users", error)
  return data.users.find((u) => u.email === email.toLowerCase()) ?? null
}

/** True when an Auth "…_sent_at" timestamp is at or after `since` (Supabase records it when it hands the email to SMTP). */
export function sentSince(at: string | null | undefined, since: number) {
  return Boolean(at) && new Date(at!).getTime() >= since - 5_000
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).not.toHaveURL(/\/login(\?|$)/)
}

const sessions = new Map<string, Awaited<ReturnType<import("@playwright/test").BrowserContext["cookies"]>>>()
/**
 * Signs in through the UI once per user, then reuses that session's cookies. The app allows only
 * 8 sign-ins per email per 15 minutes, which a long serial suite would otherwise exhaust.
 */
export async function signInOnce(page: Page, email: string) {
  const cached = sessions.get(email)
  if (cached) {
    await page.context().addCookies(cached)
    return
  }
  await signIn(page, email)
  sessions.set(email, await page.context().cookies())
}
