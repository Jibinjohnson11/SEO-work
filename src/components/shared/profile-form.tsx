"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect, SwitchField } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { TIMEZONES } from "@/lib/timezones"
import { updateMyProfile } from "@/server/profile"
import { signOutEverywhere } from "@/server/auth-actions"

export function ProfileForm({ initial, email }: { initial: { full_name: string; phone: string; timezone: string; email_notifications: boolean }; email: string }) {
  const [v, setV] = useState(initial)
  const { pending, execute } = useAction()
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="p-email" hint="Contact your administrator to change it"><Input id="p-email" value={email} disabled /></Field>
        <Field label="Full name" htmlFor="p-name"><Input id="p-name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Time zone" htmlFor="p-tz"><NativeSelect id="p-tz" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</NativeSelect></Field>
      </div>
      <SwitchField label="Email me a digest of notifications" description="Only when email delivery is enabled by the administrator" checked={v.email_notifications} onCheckedChange={(c) => setV({ ...v, email_notifications: c })} />
      <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
        <form action={signOutEverywhere}><Button type="submit" variant="outline">Sign out on all devices</Button></form>
        <Button disabled={pending} onClick={() => execute(() => updateMyProfile(v))}>{pending ? "Saving…" : "Save profile"}</Button>
      </div>
    </div>
  )
}
