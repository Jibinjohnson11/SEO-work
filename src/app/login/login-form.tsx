"use client"

import { useActionState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resendConfirmation, signIn } from "@/server/auth-actions"

function ResendConfirmation({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendConfirmation, undefined)
  if (state?.message)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {state.message}
      </p>
    )
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Resend confirmation email"}
      </Button>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined)
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {notice ? <p className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">{notice}</p> : null}
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error ? (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      {state?.unconfirmedEmail ? <ResendConfirmation key={state.unconfirmedEmail} email={state.unconfirmedEmail} /> : null}
    </div>
  )
}
