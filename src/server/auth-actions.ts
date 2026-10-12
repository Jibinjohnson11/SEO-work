"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { HOME_FOR_ROLE } from "@/lib/auth"
import { publicEnv } from "@/lib/env"
import { safeRedirectPath } from "@/lib/url"
import type { AppRole } from "@/lib/types"

type FormState = { error?: string; message?: string } | undefined

async function clientIp() {
  const h = await headers()
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown"
}

async function rateLimited(key: string, limit: number, windowSeconds: number) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) return false // never lock users out because the limiter itself failed
  return data === false
}

async function appOrigin() {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}

const signInSchema = z.object({ email: z.email(), password: z.string().min(1) })

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") })
  if (!parsed.success) return { error: "Enter your email and password." }
  const email = parsed.data.email.toLowerCase()
  const ip = await clientIp()
  if ((await rateLimited(`login:ip:${ip}`, 20, 900)) || (await rateLimited(`login:email:${email}`, 8, 900)))
    return { error: "Too many sign-in attempts. Wait 15 minutes and try again." }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password })
  if (error) return { error: "Invalid email or password." }

  const { data: role } = await supabase.rpc("record_sign_in")
  if (!role) {
    await supabase.auth.signOut()
    return { error: "Your account is not active. Contact your administrator." }
  }
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "")
  const home = HOME_FOR_ROLE[role as AppRole]
  redirect(next && next.startsWith(home) ? next : home)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export async function signOutEverywhere() {
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "global" })
  redirect("/login")
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(formData.get("email") ?? "").toLowerCase())
  if (!email.success) return { error: "Enter a valid email." }
  if (await rateLimited(`reset:${await clientIp()}`, 5, 3600))
    return { error: "Too many requests. Try again later." }
  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await appOrigin()}/auth/confirm?next=/auth/set-password`,
  })
  // Same response whether or not the account exists.
  return { message: "If an account exists for that email, a reset link is on its way." }
}

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .regex(/[A-Za-z]/, "Include a letter")
      .regex(/\d/, "Include a number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] })

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = passwordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims?.sub) return { error: "Your link has expired. Request a new one." }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }
  const { data: role } = await supabase.rpc("record_sign_in")
  if (!role) {
    await supabase.auth.signOut()
    return { error: "Your password was set, but your account is not active. Contact your administrator." }
  }
  redirect(HOME_FOR_ROLE[role as AppRole])
}
