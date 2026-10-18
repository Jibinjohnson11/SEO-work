# LinkOps — SEO Campaign Management Platform

LinkOps lets an agency run backlink campaigns end to end:

- The **Super Admin** configures clients, campaigns, keywords, interns, tasks, backlink types and every workflow setting.
- **Interns** submit opportunities and content for the campaigns they're assigned to.
- **Clients** approve content in their own portal.
- The platform tracks publication and checks that links are live, then produces timestamp-accurate reports.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS 4, shadcn/ui (Base UI), Supabase (Postgres, Auth, Storage, Row Level Security), Zod, React Hook Form, TanStack Table, Recharts, Motion. Exports use ExcelJS, PapaParse and jsPDF. Scheduled jobs run on Vercel Cron.

---

## 1. Setup

### 1.1 Create the Supabase project
1. Create a project at supabase.com.
2. Apply the migrations in `supabase/migrations/` **in filename order**. Use either method:
   - CLI: `supabase link --project-ref <ref>` then `supabase db push`
   - Dashboard → SQL Editor: paste and run each file in order.
3. Configure **Authentication → Providers / Settings**:
   - **Allow new users to sign up** and keep **Confirm email** on. This powers the *Create account* page. Self-registered accounts have **no access** until a Super Admin approves them (see §2.1). To stay invitation-only instead, disable sign-ups; the page then shows a "self-registration is turned off" message.
   - Site URL: your app URL, e.g. `https://linkops.your-agency.com`.
   - Redirect URLs: add `https://<your-app>/auth/confirm`.
4. Update **Authentication → Email Templates** so the *Invite user*, *Reset password* and *Confirm signup* links point to `/auth/confirm`. Copy the templates from `supabase/templates/`. They use `{{ .TokenHash }}`. Opening a link shows a short *Continue* page, and the one-time token is verified only when the person presses the button, so corporate mail scanners that open links cannot use them up.
5. Configure **custom SMTP** (Authentication → SMTP Settings). Supabase's built-in mailer is for development only and is heavily rate-limited, so confirmation, invitation and reset emails will not reliably reach users without it.

The migrations create every table, RLS policy, workflow function, the private `submission-files` storage bucket, and the default configuration (backlink types and settings). They create **no** clients, campaigns or submissions.

### 1.2 Environment variables
Copy `.env.example` to `.env.local` locally, and set the same variables in Vercel:

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Anon / publishable key (safe in the browser; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server only.** Used for invitations, disabling users, sign-in rate limiting, the scheduled job and the bootstrap script. |
| `NEXT_PUBLIC_APP_URL` | yes | Public URL, used in invitation and reset links |
| `CRON_SECRET` | yes | Protects `/api/cron/daily` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Email digests and scheduled report emails |

If something required is missing, the app doesn't pretend to work:
- Missing Supabase settings: every page redirects to `/setup`, which lists the missing variables.
- Missing service role key: invitations fail with a message naming the variable.
- Missing `CRON_SECRET`: the cron route returns `503`.
- Missing email settings: email features are marked "not configured" under **Settings → Security**.

### 1.3 Create the Super Admin (you)
The Super Admin role can't be obtained through sign-up, the UI, or any profile field. Create it once from a trusted machine:

```bash
npm install
npm run bootstrap:admin -- owner@your-agency.com "Your Name"
```

This sends an invitation email. Accept it to set your password, then sign in. The script sets the role in Supabase `app_metadata` and in `profiles` using the service role key. To promote an existing account instead, run the same command with that account's email.

### 1.4 Run locally
```bash
npm run dev            # http://localhost:3000
npm run check          # typecheck + lint + all tests
```

### 1.5 Deploy to Vercel
1. Import the repository into Vercel and set the environment variables above.
2. `vercel.json` schedules `GET /api/cron/daily` at 00:30 UTC every day. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
3. The cron route sets `maxDuration = 300` seconds. On plans with a lower limit, reduce **Settings → Verification → Max checks per run**.
4. The cron route responds `500` when any step failed (the JSON body lists the errors), so the platform's cron monitoring flags failed runs. Failed report emails are retried on the next runs (up to 3 attempts).
5. Point an uptime monitor at `GET /api/health` (200 = app configured and Supabase reachable, 503 otherwise).
6. GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, tests and a build on every pull request and push. It never deploys; the hosting platform builds and deploys from the repository.

---

## 2. Roles and security model

| | Super Admin | Intern | Client |
|---|---|---|---|
| Clients, campaigns, keywords, tasks, types, settings | full control | read assigned campaigns only | – |
| Submissions | read all; review, forward, override (if enabled), reassign, archive, edit | create/edit **own** drafts and returned work; publish own approved work | approve / reject / request changes for **own workspace**, version-pinned |
| Reports | all, plus snapshots and publishing | own performance | published snapshots for own workspace (download if permitted) |

Security is enforced in the database, not just by hiding UI:

- **Row Level Security on every table.** Interns only see rows for campaigns they're actively assigned to, and only their own submissions. Client users have **no direct access** to internal tables. They read through `client_portal_*` functions, which return client-safe columns for their workspace and apply the per-client portal visibility settings. Internal notes, internal reviews and team assignments never reach clients.
- **The workflow is enforced by Postgres functions** (`supabase/migrations/*_workflow.sql`). Nobody has `INSERT`/`UPDATE` rights on submissions, reviews, approvals, publications or verification checks. Each state change goes through a `SECURITY DEFINER` function that checks the caller's role and the allowed transition, then writes history and notifications in the same transaction. Calling the Supabase API directly with a user token can't skip a step.
- **Privileged profile fields are protected by a trigger.** Role, status and targets can only be changed by a Super Admin. The `super_admin` role can never be granted or removed from the application. You also can't disable your own account.
- **Disabled users** lose all data access immediately (`auth_role()` returns null), and their auth user is banned so their session can't refresh.
- **The audit log is append-only.** `activity_logs` and `submission_events` reject `UPDATE`/`DELETE` for everyone. Triggers log every data change, and workflow functions log decisions, including explicit `submission.admin_override` entries. Records are archived rather than deleted, and foreign keys use `RESTRICT` where deletion would destroy history.
- **Other protections:**
  - Server Actions validate input with Zod, then re-check the role server-side (`authorize()`).
  - Server Actions have built-in Origin checks (CSRF).
  - Sign-in, sign-up, password-reset and resend-confirmation requests are rate-limited in the database (`check_rate_limit`). Only the server (service role) can call the limiter, so clients cannot choose or reset its limits. Enable CAPTCHA in Supabase Auth as well, since Supabase's auth API can be called directly.
  - Redirect targets are restricted to in-app paths.
  - File uploads are limited by MIME type and extension (max 10 MB) and stored in a private bucket with storage RLS. Downloads use 2-minute signed URLs.
  - Text exported to Excel/CSV is escaped against formula injection.
  - Security headers, including a Content-Security-Policy and HSTS, are set in `next.config.ts`.
- **Self-registration and feature permissions** are covered in §2.1.
- **The service role key is only used server-side** (`src/lib/supabase/admin.ts`, which imports `server-only`), and only after an explicit Super Admin check, or by the cron route after verifying `CRON_SECRET`.

### 2.1 Registration, approval and feature access

1. **Sign-up.** Anyone can create an account at `/signup`. After confirming their email they can sign in, but their profile is `pending` with **no role**. They see only an "awaiting administrator approval" page. `auth_role()` is null for them, so every RLS policy and RPC denies them data.
2. **Approval.** In **Administration → Users & Access** the Super Admin approves or rejects each registration. Approving assigns a role (Intern or Client, plus a workspace or campaigns) and the features the account may use. This runs in one transaction (`approve_registration()`). Super Admin can never be granted from the app. A role is assigned once and can't be changed afterwards.
3. **Features.** Each role has a catalog of features (`src/lib/permissions.ts`), for example *My Tasks*, *Create & edit submissions*, *Approve or reject content* and *Download reports*. A user either follows the **role defaults** (editable on the same page) or has an **explicit list**. Changes apply on the user's next request. Removing every feature revokes access without disabling the account. Existing and invited users follow the role defaults, which start with every feature, so nothing changes for them.
4. **Enforcement.** The checks run in four places:
   - **Database:** `my_permissions()` / `has_permission()`. The RPCs behind each feature check it: submission save/files/publication, task status, client decisions, the `client_portal_*` reads and the client reports policy.
   - **Pages:** every page calls `requireRole(roles, feature)` and redirects to the user's first permitted page.
   - **Server Actions and API routes:** these call `authorize(roles, feature)`.
   - **UI:** the sidebar, search and in-page buttons only show permitted features. This is for convenience, not security.

   Interns' direct table reads are still limited by RLS to their own assigned work. Per-feature limits on those reads are enforced in the app layer.

---

## 3. Workflow

```
Draft → Submitted → Internal Review ─┬─ Internal Changes Requested → (intern revises → new version) → Submitted
                                     ├─ Internally Rejected (can be reassigned)
                                     └─ Internally Approved → Awaiting Client Approval ─┬─ Client Changes Requested → revise → Submitted
                                                                                        ├─ Client Rejected (can be reassigned)
                                                                                        └─ Client Approved → Ready for Publication
                                     → Published → Verification Pending → Verified Live / Verification Failed   (+ Archived)
```

- **Per client and per campaign settings:** internal review and client approval can each be switched off. Skipped stages still record a "Submitted" event, so reports stay consistent.
- **Versions.** Every submit snapshots the material content (website, placement, target, anchor, title, draft) as a new version, but only if it changed. A client decision records the exact version it applies to. If the content changes while the client is reviewing, their approval is rejected and they're shown the new version. If an admin materially edits approved content, it goes back to the client for re-approval when re-approval is enabled.
- **Medical campaigns.** Internal approval is blocked until a person confirms medical accuracy, claims verified and sources checked, and enters the reviewer's name (qualification, compliance notes and date are also recorded). Nothing is filled in automatically.
- **Admin override.** Off by default. When enabled, it requires a reason, is stored with `is_admin_override = true`, shows as "Agency override" everywhere (including to the client), notifies the client, and never counts as a client approval in reports.
- **Duplicates.** A placement (normalized published URL plus normalized target URL) can be recorded as published only once. `http`/`https`, `www.`, trailing slashes and fragments are treated as the same URL.

## 4. Reporting rules
- Every count comes from `report_events`: the **first** time each submission reached each milestone (submitted, internally approved, client approved, published, verified live, rejected). Revisions, re-reviews and repeated verification checks never count twice.
- Events are bucketed by calendar date in the report's time zone. A single-client report uses that client's time zone; otherwise it uses **Settings → Reports → Reporting time zone**. A submission sent Monday and approved Wednesday counts as submitted on Monday and approved on Wednesday.
- **Assigned target** comes from tasks: daily tasks count their quantity on each active day; weekly and monthly tasks count once per period; one-off tasks count on their due date. **Pending** is the number of submissions first submitted in the period that are still open now. Period activity and cumulative "live now" totals are shown separately.
- Reports can be exported to Excel, CSV and PDF. Saved snapshots can be published to a client's portal (single-client only). Grouping by intern is blocked for clients whose portal hides team names. The daily job can generate and email a scheduled report.

## 5. Backlink verification
`src/lib/verification/`:
1. **Fetching.** Only `http`/`https` URLs on standard ports, with no credentials. Every resolved IP is checked **at connection time** against private, loopback, link-local, CGNAT, metadata and other reserved ranges, which defeats DNS rebinding. Redirects are re-validated hop by hop. Timeouts, a response-size cap and a per-domain delay apply. `robots.txt` is honoured (configurable).
2. **Matching.** The page counts as live only if the target URL is present as an `<a href>`. An HTTP 200 alone is never treated as proof. The check records anchor text and `rel` (nofollow, sponsored, ugc), and marks the link "changed" when the anchor or attribute differs from what was recorded.
3. **Inconclusive results.** Robots-blocked, 401/403/429, non-HTML and script-rendered pages are marked *inconclusive* and left for manual verification, which requires evidence notes.

Checks run from **Backlink Verification** ("Check now" or bulk) and in the daily job for links due for a re-check.

## 6. Tests
```bash
npm test          # all tests
npm run test:db   # schema, RLS and workflow against real Postgres (PGlite) with Supabase auth/storage stubs
npm run test:unit # reporting maths, time zones/DST, verification parsing, SSRF guards, workflow rules
```

The DB suite applies all migrations and runs the full flow: admin creates client → campaign → assigns intern (via task) → intern drafts and submits → required-field and medical checks → changes requested → new version → internal approval → client approval pinned to a version → publication → duplicate-placement rejection → verification (failure, then recovery) → report events counted once. It also covers tenant isolation, role-escalation attempts, the append-only audit log, notification de-duplication, reassignment and report publishing.

## 7. Notes and limits
- `src/lib/types.ts` is hand-written to match the schema. Once your project is linked, you can generate types with `supabase gen types typescript`.
- Tables are paged in the browser over server-filtered results. List pages cap at 1,000–3,000 of the most recently updated rows and say so when the cap is reached. Narrow the filters to see older records.
- The UI has passed type-check, lint, a production build, and smoke tests without Supabase configured. It has **not** been exercised against a live Supabase project in this environment. Run through the workflow once after setup (section 3) before going live.
