import { describe, expect, it } from "vitest"
import { buildStagingEnv, parseEnvFile } from "../../scripts/staging-env.mjs"

// The staging loader must refuse anything that could reach production and must shadow every
// production variable so Next.js cannot fall back to .env.local.

const PROD_REF = "zyrsaxndmamjjayqihdm"
const STAGING_REF = "abcdefghijklmnopqrst"
const production = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_PRODUCTIONpublishableKEY0000",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_PRODUCTIONsecretKEY00000000000",
  SUPABASE_DB_URL: `postgresql://postgres.${PROD_REF}:prodpassword123@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  CRON_SECRET: "production-cron-secret-0123456789abcdef",
  RESEND_API_KEY: "re_PRODUCTION_resend_key_000000",
}
const good = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_STAGINGpublishableKEY000000",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_STAGINGsecretKEY0000000000000",
  STAGING_DB_URL: `postgresql://postgres.${STAGING_REF}:Staging%40Pass%23123@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  NEXT_PUBLIC_APP_URL: "http://localhost:3100",
  CRON_SECRET: "staging-cron-secret-0123456789abcdef0000",
  RESEND_API_KEY: "",
}
const build = (staging: Record<string, string>) => buildStagingEnv({ staging, production: [production] })
const jwt = (ref: string, role: string) => `x.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.y`

describe("a correct staging configuration", () => {
  it("passes and targets the staging project", () => {
    const r = build(good)
    expect(r.errors).toEqual([])
    expect(r.ref).toBe(STAGING_REF)
  })

  it("shadows every production variable, so .env.local can never fill a gap", () => {
    const { env } = build(good)
    for (const k of Object.keys(production)) expect(env).toHaveProperty(k)
    expect(env.SUPABASE_DB_URL).toBe("") // production-only variable is blanked, not inherited
    expect(Object.values(env).some((v) => String(v).includes(PROD_REF))).toBe(false)
  })

  it("derives the end-to-end settings from the staging values and builds into .next-staging", () => {
    const { env } = build(good)
    expect(env).toMatchObject({ E2E_TARGET: "staging", E2E_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL, E2E_SUPABASE_SECRET_KEY: good.SUPABASE_SERVICE_ROLE_KEY, NEXT_DIST_DIR: ".next-staging" })
  })
})

describe("anything that could reach production is refused", () => {
  it("the production project URL", () => {
    expect(build({ ...good, NEXT_PUBLIC_SUPABASE_URL: production.NEXT_PUBLIC_SUPABASE_URL }).errors).toContain("NEXT_PUBLIC_SUPABASE_URL is the PRODUCTION project")
  })

  it("a production key or secret copied into the staging file", () => {
    expect(build({ ...good, SUPABASE_SERVICE_ROLE_KEY: production.SUPABASE_SERVICE_ROLE_KEY }).errors).toContain("SUPABASE_SERVICE_ROLE_KEY is identical to a production value from .env.local")
    expect(build({ ...good, CRON_SECRET: production.CRON_SECRET }).errors).toContain("CRON_SECRET is identical to a production value from .env.local")
  })

  it("the production database connection string", () => {
    const errs = build({ ...good, STAGING_DB_URL: production.SUPABASE_DB_URL }).errors
    expect(errs).toContain("STAGING_DB_URL refers to the PRODUCTION project")
    expect(errs).toContain("STAGING_DB_URL is identical to a production value from .env.local")
  })

  it("any value mentioning the production project reference", () => {
    expect(build({ ...good, NEXT_PUBLIC_APP_URL: `https://${PROD_REF}.example.com` }).errors).toContain("NEXT_PUBLIC_APP_URL refers to the PRODUCTION project")
  })

  it("a legacy JWT key issued for production", () => {
    const errs = build({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt(PROD_REF, "service_role") }).errors
    expect(errs).toContain("SUPABASE_SERVICE_ROLE_KEY is a PRODUCTION key")
  })

  it("a database URL for a different project than the staging URL", () => {
    expect(build({ ...good, STAGING_DB_URL: good.STAGING_DB_URL.replace(STAGING_REF, "zzzzzzzzzzzzzzzzzzzz") }).errors).toContain(
      "STAGING_DB_URL is for a different project than NEXT_PUBLIC_SUPABASE_URL",
    )
  })

  it("keys of the wrong type (secret in the public slot)", () => {
    expect(build({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: good.SUPABASE_SERVICE_ROLE_KEY }).errors).toContain(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not a publishable key for the staging project",
    )
  })
})

describe("configuration mistakes are reported clearly", () => {
  it("missing required values", () => {
    const errs = build({ ...good, SUPABASE_SERVICE_ROLE_KEY: "", CRON_SECRET: "" }).errors
    expect(errs).toEqual(expect.arrayContaining(["SUPABASE_SERVICE_ROLE_KEY is missing or empty", "CRON_SECRET is missing or empty"]))
  })

  it("a database password still wrapped in [ ] or not percent-encoded", () => {
    const bracketed = `postgresql://postgres.${STAGING_REF}:[Pass@word]@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`
    const errs = build({ ...good, STAGING_DB_URL: bracketed }).errors
    expect(errs).toContain("STAGING_DB_URL password is still wrapped in [ ] (remove the brackets)")
    expect(errs).toContain("STAGING_DB_URL password has characters that must be percent-encoded")
  })

  it("a project URL with a path after .supabase.co", () => {
    expect(build({ ...good, NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co/rest/v1/` }).errors).toContain(
      "NEXT_PUBLIC_SUPABASE_URL must be exactly https://<20-character-ref>.supabase.co",
    )
  })
})

describe("staging email can never reach a real client", () => {
  it("always runs with a recipient allowlist, defaulting to Resend's test inboxes", () => {
    expect(build(good).env.EMAIL_ALLOWED_RECIPIENTS).toBe("@resend.dev")
    expect(build({ ...good, EMAIL_ALLOWED_RECIPIENTS: "  " }).env.EMAIL_ALLOWED_RECIPIENTS).toBe("@resend.dev")
    expect(build({ ...good, EMAIL_ALLOWED_RECIPIENTS: "@resend.dev, qa@example.org" }).env.EMAIL_ALLOWED_RECIPIENTS).toBe("@resend.dev, qa@example.org")
  })
  it("refuses wildcards and malformed entries", () => {
    for (const bad of ["*", "@", "@*.com", "everyone"])
      expect(build({ ...good, EMAIL_ALLOWED_RECIPIENTS: bad }).errors.join()).toContain("EMAIL_ALLOWED_RECIPIENTS entry")
  })
  it("needs a sender when a Resend key is set, and never accepts the production key", () => {
    expect(build({ ...good, RESEND_API_KEY: "re_STAGING_key_0000000000000" }).errors).toContain("EMAIL_FROM is required when RESEND_API_KEY is set")
    expect(build({ ...good, RESEND_API_KEY: production.RESEND_API_KEY, EMAIL_FROM: "x@resend.dev" }).errors).toContain("RESEND_API_KEY is identical to a production value from .env.local")
  })
})

describe("env file parsing", () => {
  it("reads KEY=VALUE lines, strips quotes, ignores comments", () => {
    expect(parseEnvFile(`# c\nA=1\nB="two words"\nexport C='3'\n  \nNOT A LINE`)).toEqual({ A: "1", B: "two words", C: "3" })
  })
})
