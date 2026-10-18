# Staging email (Resend)

LinkOps sends email through two separate channels. Staging needs both, configured so that staging can never reach a real client.

| Channel | Emails | Sent by | Configured in |
|---|---|---|---|
| **Auth emails** | Registration confirmation, invitation, password reset | Supabase Auth, through its **custom SMTP** | Supabase dashboard (staging project) |
| **App emails** | Notification digests, scheduled report emails (daily job) | The app, through **Resend's HTTP API** (`src/lib/email.ts`) | `RESEND_API_KEY`, `EMAIL_FROM` |

## How staging is kept away from real recipients

There are three independent layers. Any one of them is enough to stop a real client being emailed.

1. **Staging data contains only test addresses.** Every staging user is a Resend test inbox (`delivered+…@resend.dev`), and no client has a contact email. The end-to-end tests only ever create `@resend.dev` addresses, or the reserved `example.com` domain, which can never receive mail.
2. **App allowlist (`EMAIL_ALLOWED_RECIPIENTS`).**
   - The staging loader (`scripts/staging-env.mjs`) always sets it. The default is `@resend.dev`. The loader refuses wildcards and malformed entries.
   - When it is set, the app refuses to send to, or ask Supabase to email, any other address:
     - sign-up shows "This test environment only sends email to approved test addresses";
     - invite, re-invite and admin password reset fail with that message;
     - the reset form and "resend confirmation" silently send nothing, and their answer is unchanged;
     - digests and report emails fail with an error, and nothing is sent.
   - **Production must never set this variable.** It is unset in `.env.local` and `render.yaml`.
3. **Provider restriction (recommended).** Use a separate Resend team for staging, with **no verified domain**, and send from `onboarding@resend.dev`. Resend then delivers only to the team owner's own address and to `@resend.dev` test inboxes.
   - This also covers emails the app never sees: someone calling the staging Supabase Auth API directly with the public key, or an operator using "Invite user" in the Supabase dashboard.

## Manual setup (you do these; nothing here is enabled yet)

### A. Resend
1. In Resend, create a team for staging, e.g. "LinkOps Staging". Do not add a domain to it.
2. Create two API keys with **Sending access**:
   - `linkops-staging-supabase-smtp` (pasted into Supabase only);
   - `linkops-staging-app` (pasted into `.env.e2e` only).

   Two keys mean either one can be revoked on its own. Never reuse the production key, and never paste a key into chat, a ticket or the repo.
3. Check the plan's limits (the free plan allows about 100 emails a day). Each full email test run sends fewer than 10.

> **Only if you need staging to email other addresses** (for example a colleague's inbox): verify a staging-only subdomain such as `staging-mail.<your-domain>` in that team, and restrict the app key to that domain. You lose layer 3, so the app allowlist becomes the only guard for app-triggered mail. Add the DNS records exactly as Resend shows them (Domains → your domain):
>
> | Type | Name (host) | Value | Notes |
> |---|---|---|---|
> | MX | `send.staging-mail` | `feedback-smtp.<region>.amazonses.com` | priority 10 (bounce handling) |
> | TXT | `send.staging-mail` | `v=spf1 include:amazonses.com ~all` | SPF |
> | TXT | `resend._domainkey.staging-mail` | `p=…` (copy from Resend) | DKIM |
> | TXT | `_dmarc` (of the parent domain, if not already present) | `v=DMARC1; p=none;` | DMARC; tighten later |

### B. Supabase (staging project `flvdmarzdthbtobezxhn` only)
Under **Authentication** in the staging project:
1. **Emails → SMTP Settings → Enable custom SMTP.**

   | Field | Value |
   |---|---|
   | Sender email | `onboarding@resend.dev` (or your verified staging subdomain address) |
   | Sender name | `LinkOps Staging` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the `linkops-staging-supabase-smtp` key (paste it in the dashboard) |

2. **Emails → Templates.** Paste these three templates with their subjects, which come from `supabase/config.toml`:

   | Template | File | Subject |
   |---|---|---|
   | Confirm signup | `supabase/templates/confirmation.html` | "Confirm your LinkOps account" |
   | Invite user | `supabase/templates/invite.html` | "You're invited to LinkOps" |
   | Reset password | `supabase/templates/recovery.html` | "Reset your LinkOps password" |

   The links use `{{ .SiteURL }}`, so step 3 decides where they point.
3. **URL Configuration.**
   - Site URL: `http://localhost:3100`, or your staging Render URL once one exists.
   - Redirect URLs: `http://localhost:3100/**`.
4. **Sign In / Providers → Email.** Confirm email **on**.
5. **Rate Limits.** "Emails sent per hour" defaults to 30 once custom SMTP is on, which is enough for the tests.

### C. `.env.e2e` (local, git-ignored)
```
RESEND_API_KEY=<the linkops-staging-app key>
EMAIL_FROM="LinkOps Staging <onboarding@resend.dev>"
EMAIL_ALLOWED_RECIPIENTS=@resend.dev        # optional: add your own address, comma-separated
E2E_SMTP_CONFIGURED=1                       # after step B works
E2E_APP_EMAIL=1                             # after RESEND_API_KEY / EMAIL_FROM are set
```
The loader refuses a `RESEND_API_KEY` that is identical to a production value, and requires `EMAIL_FROM` whenever a key is set. Run `npm run staging:check` to validate. It never prints values.

If you later deploy a staging Render service, set the same three email variables on it, including `EMAIL_ALLOWED_RECIPIENTS`. The production service must not have `EMAIL_ALLOWED_RECIPIENTS`.

## Tests (`e2e/email.spec.ts`, `e2e/journeys.spec.ts`)

| Test | Runs when | Checks |
|---|---|---|
| Sign-up with an outside address is refused | always (staging) | Refusal message shown; no Auth user created |
| Admin cannot invite an outside address | always (staging) | Refusal message shown; no Auth user or profile |
| Registration confirmation (journeys) | `E2E_SMTP_CONFIGURED=1` | UI confirms; Supabase recorded `confirmation_sent_at` |
| Invitation from the Interns page (journeys) | `E2E_SMTP_CONFIGURED=1` | "Invitation sent"; `invited_at` recorded |
| Password reset form (journeys) | `E2E_SMTP_CONFIGURED=1` for delivery | Same answer either way; `recovery_sent_at` recorded |
| Admin re-sends an invitation | `E2E_SMTP_CONFIGURED=1` | `invited_at` updated |
| Admin sends a password reset | `E2E_SMTP_CONFIGURED=1` | `recovery_sent_at` updated |
| Daily job: digest and scheduled report | `E2E_APP_EMAIL=1` | `"N of M digests"`, `"sent 1 of 1"`; the notification's `emailed_at` and the report's `email_status = sent` are recorded |
| Daily job again (no duplicates) | `E2E_APP_EMAIL=1` | `0 of 0 digests`, `already generated`, `nothing pending` |
| Digest to an outside address | `E2E_APP_EMAIL=1` | Job reports the refusal without the address; the notification stays un-emailed |

What the `E2E_APP_EMAIL` tests do to staging, and nothing else:
- They turn on digests and a daily CSV report sent to a test inbox, and restore both settings afterwards.
- They mark the existing backlog of unread test notifications as handled. Staging has about 3,300 from earlier runs, which would otherwise go out as about 130 digests.
- They delete the scheduled daily reports from the last 3 days, so a fresh one is generated and emailed.

**Not automated:**
- Inbox placement, spam scoring and SPF/DKIM/DMARC alignment. To check them, send one email of each kind to your own address (add it to `EMAIL_ALLOWED_RECIPIENTS`) and look at the headers.
- Resend's delivery status. The tests confirm that Supabase or the app handed the email to Resend. Check Resend → Emails for the `delivered` events.

**Turning on digests manually in staging** (Settings → Notifications) sends that backlog of about 130 digests to test inboxes. Run the email tests first, or ask for the backlog to be marked handled.
