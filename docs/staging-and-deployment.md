# LinkOps — staging, end-to-end tests and Render deployment

This is the companion to [go-live-checklist.md](go-live-checklist.md). Nothing here touches the production Supabase project (`zyrsaxndmamjjayqihdm`) except where a step says so explicitly.

## 1. Staging environment (a separate Supabase project)

**Why:** the end-to-end tests create users, clients, submissions and files. Audit records are append-only and can't be removed, so those tests must never run against production.

1. **Create the project** (owner action). In the Supabase dashboard, choose **New project**, name it `linkops-staging`, pick region **Northeast Asia (Seoul)** (the same as production), and use the Free plan.
2. **Apply the migrations.**
   - A new project has no history, so `supabase db push` applies all 15 migration files in order and records them:
     ```bash
     npx supabase@2.121.0 db push --db-url "<staging session-pooler URL>"
     ```
   - Then verify with `npx supabase@2.121.0 migration list --db-url …`, which should show 15/15.
3. **Configure Auth** under **Authentication**:
   - **URL Configuration:** Site URL `http://localhost:3100`, redirect URL `http://localhost:3100/auth/confirm`. Add the staging Render URL later, if you create one.
   - **Email Templates:** paste the 3 files from `supabase/templates/`.
   - **SMTP:** Resend, so that real-email tests can run. Follow [staging-email.md](staging-email.md): it uses a separate Resend team and keys, and staging may email only test addresses.
   - **Providers → Email:** Confirm email **on**; minimum password length **10**.
4. **Seed the first Super Admin.** Run `npm run bootstrap:admin -- you@your-domain.com "Staging Admin"` with a staging env file. The end-to-end tests create their own admins, so this is only for manual testing.

### Staging environment file (`.env.e2e`, git-ignored by the `.env*` rule)
```
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging publishable key>
SUPABASE_SERVICE_ROLE_KEY=<staging secret key>
NEXT_PUBLIC_APP_URL=http://localhost:3100
CRON_SECRET=<random>
# for the tests
E2E_TARGET=staging
E2E_BASE_URL=http://localhost:3100
E2E_SUPABASE_URL=https://<staging-ref>.supabase.co
E2E_SUPABASE_SECRET_KEY=<staging secret key>
# E2E_SMTP_CONFIGURED=1        # only once staging SMTP works (see staging-email.md)
# E2E_APP_EMAIL=1              # only once RESEND_API_KEY / EMAIL_FROM are set (see staging-email.md)
# EMAIL_ALLOWED_RECIPIENTS=@resend.dev   # set by the loader if omitted; never set it in production
```

Every variable the app reads must be in this file. `next build` and `next start` also read `.env.local` (production), but **values already in the environment win**. The tests check the app's Content-Security-Policy and refuse to run if the app is wired to production.

## 2. End-to-end tests (Playwright, `e2e/`)

| Command | What it runs | Writes data? |
|---|---|---|
| `npm run e2e:readonly` | `e2e/public.spec.ts`: public pages, the sign-in gate on 6 protected routes, the scanner-safe Continue page, health check, cron refusal, security headers | No. Safe against any environment, including production |
| `npm run e2e` (with `E2E_TARGET=staging`) | Plus `e2e/journeys.spec.ts`: registration, confirmation, pending restrictions, approval and role, dashboard access, invitation acceptance, submissions, uploads, password reset, role isolation | Yes, **staging only** |

**Production guard:** write tests run only when `E2E_TARGET=staging`. The service-role client **can't be created** until both of these are confirmed:
- `E2E_SUPABASE_URL` isn't the production project;
- the running app's CSP names that same staging project.

Both refusals were tested against production on 2026-10-16, with an invalid key as a second safety layer: 0 setup calls were made.

**Run against staging, locally:**
```bash
export PATH="$HOME/.local/node22/bin:$PATH"
set -a; source .env.e2e; set +a        # these values take precedence over .env.local
npm run build && (npx next start -p 3100 &) && npm run e2e
```

### Which tests need real email delivery or external credentials

| Test | Needs |
|---|---|
| All `@readonly` tests | Only a running app |
| Confirmation link, pending page, approval, dashboard access, invitation **acceptance**, password **change** via the recovery link, submissions, uploads, role isolation | Staging **secret key**. One-time links come from the Admin API (`generateLink`), which sends **no email** |
| "registration form … asks to confirm the email" | **Staging SMTP** (real send). Enable with `E2E_SMTP_CONFIGURED=1` |
| "the Super Admin sends an invitation" | **Staging SMTP** (real send). Enable with `E2E_SMTP_CONFIGURED=1` |
| "the reset form always answers the same way" | Runs without SMTP, because the form answers identically either way. **Delivery** itself needs SMTP |
| Real inbox delivery, spam placement, SPF/DKIM/DMARC alignment | **Manual:** send to a real Gmail and Outlook address. Not automatable without an inbox API |
| Daily-job email (digests, scheduled report) | `RESEND_API_KEY` and `EMAIL_FROM`. Enable with `E2E_APP_EMAIL=1` (see [staging-email.md](staging-email.md)) |
| Outside addresses are refused (sign-up, invitation) | Always on staging, which runs with `EMAIL_ALLOWED_RECIPIENTS` |

Test addresses default to Resend's test inbox (`delivered+linkops-<run>-<label>@resend.dev`). It accepts mail without affecting your sending reputation. Override with `E2E_EMAIL_LOCAL` and `E2E_EMAIL_DOMAIN`.

## 3. Render deployment (`render.yaml`, validated against Render's schema)

**Services:**
- **`linkops`**: Node 22 web service in `singapore` on the `starter` plan. Build `npm ci && npm run build`, start `npm start`. Health check `/api/health`. It auto-deploys only after GitHub CI passes.
- **`linkops-daily`**: cron job, `30 0 * * *`. It calls `/api/cron/daily` with `CRON_SECRET`, which is shared from the web service, and **exits 1** on any non-2xx response, so Render marks the run failed. The failure handling (wrong secret, app unreachable) was tested locally.

**Before the first deploy** (owner):
1. Merge the reviewed branch.
2. Choose **Render → New → Blueprint**, then select the repo. Render reads `render.yaml`.
3. Enter the `sync: false` values: Supabase URL and keys, `NEXT_PUBLIC_APP_URL`, `APP_URL` (the same URL), and optionally Resend. `NEXT_PUBLIC_*` values are compiled into the build, so they must be set before it runs.
4. In Supabase (production) → **URL Configuration**, set the Site URL to the Render URL and add `<url>/auth/confirm` as a redirect URL.

**After the first deploy:**
1. Read-only checks: `/api/health` returns 200, signed-out visitors are redirected to sign-in, and the security headers are present. Run `npm run e2e:readonly` with `E2E_BASE_URL=<render url>`.
2. Confirm which client-IP header Render's proxy controls, then set `CLIENT_IP_HEADER` (and `TRUSTED_PROXY_HOPS` if using `x-forwarded-for`). Until then, IP limits are off and per-email limits apply. The startup log says so.
3. Watch the first `linkops-daily` run. It must exit 0, and its log must show `"ok": true`.

### Rollback
| What | How | Notes |
|---|---|---|
| **App** | Render → `linkops` → **Events** → pick the last good deploy → **Rollback** | Instant; doesn't touch the database. Disable auto-deploy first so the next merge doesn't redeploy the bad version |
| **Bad configuration** | Fix the environment variable and redeploy | `NEXT_PUBLIC_*` changes need a new build |
| **Daily job** | Suspend `linkops-daily` in Render | The app keeps working without it |
| **Database** | Migrations aren't rolled back by Render | 16–21: `supabase/rollbacks/`, run **newest first** (21 before 16; 21 replaces functions that 16's rollback restores); each keeps its data columns. 10–14: small reverse scripts (prepare and review first). 8–9: restore from `~/LinkOps-backups/…_pg-dump-post-m14` into a **new** project and switch keys (see its `RESTORE.md`). Take a fresh backup before any new migration |
| **Migration 15** (pending, not in production) | If applied and it causes problems, re-create the two functions from migrations 2–3 | Both are `create or replace` of two functions, so they're fully reversible |
