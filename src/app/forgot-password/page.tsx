"use client"

import { useActionState } from "react"
import Link from "next/link"
import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/server/auth-actions"

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined)
  return (
    <AuthCard title="Reset your password" description="We'll email you a secure link." footer={<Link href="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoFocus />
        </div>
        {state?.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        {state?.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
      </form>
    </AuthCard>
  )
}
