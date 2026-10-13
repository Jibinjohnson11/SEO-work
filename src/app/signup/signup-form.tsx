"use client"

import { useActionState } from "react"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LinkButton } from "@/components/ui/link-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signUp } from "@/server/auth-actions"

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, undefined)

  if (state?.message)
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-md bg-accent px-3 py-3 text-sm text-accent-foreground">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          <p>{state.message}</p>
        </div>
        <LinkButton href="/login" variant="outline" size="default" className="w-full">
          Back to sign in
        </LinkButton>
      </div>
    )

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" name="full_name" autoComplete="name" required autoFocus maxLength={120} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
        <p className="text-xs text-muted-foreground">At least 10 characters, with a letter and a number.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      {state?.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  )
}
