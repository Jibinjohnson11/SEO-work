"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, ListEditor, NativeSelect, SwitchField } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { saveSettings } from "@/server/admin/settings"
import { signOutEverywhere } from "@/server/auth-actions"
import { TIMEZONES } from "@/lib/timezones"
import type { SettingsKey } from "@/lib/validation"

function useSection<T extends Record<string, unknown>>(key: SettingsKey, initial: T) {
  const [value, setValue] = useState<T>(initial)
  const { pending, execute } = useAction()
  const dirty = JSON.stringify(value) !== JSON.stringify(initial)
  const set = <K extends keyof T>(k: K, v: T[K]) => setValue((prev) => ({ ...prev, [k]: v }))
  const save = () => execute(() => saveSettings(key, value))
  const footer = (
    <div className="flex justify-end gap-2 border-t pt-4">
      <Button variant="outline" disabled={!dirty || pending} onClick={() => setValue(initial)}>Reset</Button>
      <Button disabled={!dirty || pending} onClick={save}>{pending ? "Saving…" : "Save changes"}</Button>
    </div>
  )
  return { value, set, footer }
}

const num = (v: string) => (v === "" ? 0 : Number(v))

export function GeneralSettings({ initial }: { initial: { platform_name: string; logo_url: string; default_timezone: string; date_format: string; theme: string } }) {
  const { value, set, footer } = useSection("general", { ...initial, logo_url: initial.logo_url ?? "" })
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform name" htmlFor="g-name"><Input id="g-name" value={value.platform_name} onChange={(e) => set("platform_name", e.target.value)} /></Field>
        <Field label="Logo URL" hint="Square image, https://" htmlFor="g-logo"><Input id="g-logo" value={value.logo_url} onChange={(e) => set("logo_url", e.target.value)} /></Field>
        <Field label="Default time zone" hint="Pre-filled for new brands" htmlFor="g-tz">
          <NativeSelect id="g-tz" value={value.default_timezone} onChange={(e) => set("default_timezone", e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect>
        </Field>
        <Field label="Date format" htmlFor="g-date">
          <NativeSelect id="g-date" value={value.date_format} onChange={(e) => set("date_format", e.target.value)}>
            {["dd MMM yyyy", "MMM d, yyyy", "yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy"].map((f) => <option key={f}>{f}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Default theme" hint="Users can still switch from the top bar" htmlFor="g-theme">
          <NativeSelect id="g-theme" value={value.theme} onChange={(e) => set("theme", e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></NativeSelect>
        </Field>
      </div>
      {footer}
    </div>
  )
}

export function CampaignDefaults({ initial }: { initial: { daily_target: number; weekly_target: number; monthly_target: number; priority: string; working_days_per_week: number } }) {
  const { value, set, footer } = useSection("campaign_defaults", initial)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Pre-filled when creating campaigns and inviting interns. Campaign statuses (Draft, Active, Paused, Completed, Archived) and priorities (Low → Urgent) are fixed so reports stay comparable.</p>
      <div className="grid gap-4 sm:grid-cols-5">
        <Field label="Daily target" htmlFor="c-d"><Input id="c-d" type="number" min={0} value={value.daily_target} onChange={(e) => set("daily_target", num(e.target.value))} /></Field>
        <Field label="Weekly target" htmlFor="c-w"><Input id="c-w" type="number" min={0} value={value.weekly_target} onChange={(e) => set("weekly_target", num(e.target.value))} /></Field>
        <Field label="Monthly target" htmlFor="c-m"><Input id="c-m" type="number" min={0} value={value.monthly_target} onChange={(e) => set("monthly_target", num(e.target.value))} /></Field>
        <Field label="Default priority" htmlFor="c-p">
          <NativeSelect id="c-p" value={value.priority} onChange={(e) => set("priority", e.target.value)}>{["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}</NativeSelect>
        </Field>
        <Field label="Working days / week" htmlFor="c-wd" hint="New campaigns: weekly and monthly targets from the daily target"><Input id="c-wd" type="number" min={1} max={7} value={value.working_days_per_week} onChange={(e) => set("working_days_per_week", num(e.target.value))} /></Field>
      </div>
      {footer}
    </div>
  )
}

export function ApprovalSettings({ initial }: { initial: { client_approval_required: boolean; reapproval_on_material_change: boolean; allow_admin_override: boolean; medical_review_required: boolean; medical_checklist: string[]; notify_admins_on_submission: boolean; notify_client_on_forward: boolean } }) {
  const { value, set, footer } = useSection("approval", initial)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Client approval is the approval stage. Internal review applies only to medical brands and campaigns, while medical review is required. The first two switches are defaults for new brands; each brand and campaign can override client approval.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <SwitchField label="Client approval required" checked={value.client_approval_required} onCheckedChange={(c) => set("client_approval_required", c)} />
        <SwitchField label="Re-approval after material edits" description="Editing approved content sends it back to the client" checked={value.reapproval_on_material_change} onCheckedChange={(c) => set("reapproval_on_material_change", c)} />
        <SwitchField label="Medical review required for medical campaigns" description="Medical brands and campaigns always go through internal review, and approval is blocked until a person confirms the medical checklist" checked={value.medical_review_required} onCheckedChange={(c) => set("medical_review_required", c)} />
        <SwitchField label="Allow admin override of client approval" description="Always logged and shown as an override — never as a client approval. The client is notified." checked={value.allow_admin_override} onCheckedChange={(c) => set("allow_admin_override", c)} />
      </div>
      <Field label="Medical review checklist" hint="Shown to reviewers on medical submissions">
        <ListEditor value={value.medical_checklist} onChange={(v) => set("medical_checklist", v)} placeholder="Add a checklist item" />
      </Field>
      {footer}
    </div>
  )
}

export function VerificationSettings({ initial }: { initial: { auto_verify: boolean; recheck_interval_hours: number; timeout_ms: number; max_per_run: number; per_domain_delay_ms: number; respect_robots: boolean; max_redirects: number; max_bytes: number } }) {
  const { value, set, footer } = useSection("verification", initial)
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-2">
        <SwitchField label="Scheduled automatic verification" description="Runs in the daily job (needs CRON_SECRET and the service role key)" checked={value.auto_verify} onCheckedChange={(c) => set("auto_verify", c)} />
        <SwitchField label="Respect robots.txt" description="If a site disallows our crawler, the check is marked inconclusive for manual review" checked={value.respect_robots} onCheckedChange={(c) => set("respect_robots", c)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Re-check interval (hours)" htmlFor="v-int"><Input id="v-int" type="number" min={1} value={value.recheck_interval_hours} onChange={(e) => set("recheck_interval_hours", num(e.target.value))} /></Field>
        <Field label="Request timeout (ms)" htmlFor="v-to"><Input id="v-to" type="number" min={2000} max={30000} value={value.timeout_ms} onChange={(e) => set("timeout_ms", num(e.target.value))} /></Field>
        <Field label="Max checks per run" htmlFor="v-max"><Input id="v-max" type="number" min={1} value={value.max_per_run} onChange={(e) => set("max_per_run", num(e.target.value))} /></Field>
        <Field label="Delay between requests to the same domain (ms)" htmlFor="v-delay"><Input id="v-delay" type="number" min={0} value={value.per_domain_delay_ms} onChange={(e) => set("per_domain_delay_ms", num(e.target.value))} /></Field>
        <Field label="Max redirects" htmlFor="v-red"><Input id="v-red" type="number" min={0} max={10} value={value.max_redirects} onChange={(e) => set("max_redirects", num(e.target.value))} /></Field>
        <Field label="Max page size (bytes)" htmlFor="v-bytes"><Input id="v-bytes" type="number" min={100000} value={value.max_bytes} onChange={(e) => set("max_bytes", num(e.target.value))} /></Field>
      </div>
      {footer}
    </div>
  )
}

export function ReportSettings({ initial, emailConfigured }: { initial: { schedule: string; recipients: string[]; format: string; timezone: string }; emailConfigured: boolean }) {
  const { value, set, footer } = useSection("reports", initial)
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Scheduled report" htmlFor="r-s" hint="Generated by the daily job for the previous period">
          <NativeSelect id="r-s" value={value.schedule} onChange={(e) => set("schedule", e.target.value)}><option value="off">Off</option><option value="daily">Daily (yesterday)</option><option value="weekly">Weekly (Mondays, last week)</option><option value="monthly">Monthly (1st, last month)</option></NativeSelect>
        </Field>
        <Field label="Email attachment format" htmlFor="r-f"><NativeSelect id="r-f" value={value.format} onChange={(e) => set("format", e.target.value)}><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="pdf">PDF</option></NativeSelect></Field>
        <Field label="Reporting time zone" htmlFor="r-tz" hint="Single-brand reports use the brand's own zone">
          <NativeSelect id="r-tz" value={value.timezone} onChange={(e) => set("timezone", e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect>
        </Field>
      </div>
      <Field label="Report recipients" hint={emailConfigured ? "Receive the scheduled report by email" : "Email is not configured (RESEND_API_KEY / EMAIL_FROM). Reports are still generated and saved."}>
        <ListEditor value={value.recipients} onChange={(v) => set("recipients", v)} placeholder="name@agency.com" />
      </Field>
      {footer}
    </div>
  )
}

export function NotificationSettings({ initial, emailConfigured }: { initial: { email_enabled: boolean; deadline_warning_days: number }; emailConfigured: boolean }) {
  const { value, set, footer } = useSection("notifications", initial)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">In-app notifications are always on and de-duplicated per event. Email sends one digest of unread notifications per user in the daily job.</p>
      <SwitchField label="Email notification digests" description={emailConfigured ? "Users can opt out on their profile" : "Email provider not configured — set RESEND_API_KEY and EMAIL_FROM to enable."} checked={value.email_enabled} onCheckedChange={(c) => set("email_enabled", c)} disabled={!emailConfigured && !value.email_enabled} />
      <Field label="Warn team members about deadlines (days before due)" htmlFor="n-days" className="max-w-xs"><Input id="n-days" type="number" min={0} max={30} value={value.deadline_warning_days} onChange={(e) => set("deadline_warning_days", num(e.target.value))} /></Field>
      {footer}
    </div>
  )
}

export function SecuritySettings({ initial }: { initial: { idle_timeout_minutes: number; log_sign_ins: boolean } }) {
  const { value, set, footer } = useSection("security", { ...initial, log_sign_ins: true })
  return (
    <div className="space-y-4">
      <Field label="Sign out after inactivity (minutes)" hint="0 = never. Applies to all users." htmlFor="s-idle" className="max-w-xs">
        <Input id="s-idle" type="number" min={0} value={value.idle_timeout_minutes} onChange={(e) => set("idle_timeout_minutes", num(e.target.value))} />
      </Field>
      {footer}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Sign out of all sessions</p>
          <p className="text-xs text-muted-foreground">Ends your sessions on every device. To cut off another user, disable them in Users & access.</p>
        </div>
        <form action={signOutEverywhere}><Button type="submit" variant="outline">Sign out everywhere</Button></form>
      </div>
    </div>
  )
}
