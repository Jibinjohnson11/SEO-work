"use client"

import { useActionState } from "react"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { setPassword } from "@/server/auth-actions"

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, undefined)
  return (
    <AuthCard title="Choose a password" description="At least 10 characters, including a letter and a number.">
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </div>
        {state?.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Saving…" : "Save and continue"}</Button>
      </form>
    </AuthCard>
  )
}
