"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { ACCESS_PAGE, HOME_FOR_ROLE, landingForClient } from "@/lib/auth"
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
  if (error) {
    // Server log only (never the password); the user always sees the same generic message.
    console.warn("[signIn] auth rejected", { status: error.status, code: error.code })
    // Only reachable with the correct password, so this does not reveal whether an email exists.
    if (error.code === "email_not_confirmed") return { error: "Confirm your email address first — use the link we emailed you." }
    return { error: "Invalid email or password." }
  }

  const { data: role, error: roleError } = await supabase.rpc("record_sign_in")
  if (roleError) {
    console.error("[signIn] record_sign_in failed", roleError)
    await supabase.auth.signOut()
    return { error: "Sign-in could not be completed because the server is misconfigured. Contact your administrator." }
  }
  const landing = await landingForClient(supabase)
  if (!role) {
    // Self-registered accounts stay signed in and see the "awaiting approval" page.
    if (landing === ACCESS_PAGE) redirect(ACCESS_PAGE)
    await supabase.auth.signOut()
    return { error: "Your account is not active. Contact your administrator." }
  }
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "")
  const home = HOME_FOR_ROLE[role as AppRole]
  // A deep link is honoured only inside the user's own area; the page re-checks the feature.
  redirect(next && next.startsWith(home) ? next : landing)
}

const signUpSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter your full name").max(120, "Name is too long"),
    email: z.email("Enter a valid email"),
    password: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(72, "Use at most 72 characters")
      .regex(/[A-Za-z]/, "Include a letter")
      .regex(/\d/, "Include a number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] })

/**
 * Self-registration. The account is created with status 'pending' and no role (database trigger
 * public.handle_self_signup), so it has no access to any data until a Super Admin approves it
 * and chooses its role and features.
 */
export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const email = parsed.data.email.toLowerCase()
  if (await rateLimited(`signup:ip:${await clientIp()}`, 5, 3600))
    return { error: "Too many sign-up attempts. Try again later." }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await appOrigin()}/auth/confirm?next=${ACCESS_PAGE}`,
      data: { full_name: parsed.data.full_name, self_signup: true },
    },
  })
  if (error) {
    console.warn("[signUp] rejected", { status: error.status, code: error.code })
    if (error.code === "signup_disabled")
      return { error: "Self-registration is turned off on the server. Ask your administrator for an invitation." }
    if (error.code === "weak_password") return { error: error.message }
    return { error: "Your account could not be created. Try again later." }
  }
  // With email confirmation off, Supabase signs the user in straight away.
  if (data.session) redirect(ACCESS_PAGE)
  // Same response whether or not the email was already registered.
  return { message: "Check your email to confirm your address. After that, an administrator will review your account." }
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
  const landing = await landingForClient(supabase)
  if (!role && landing !== ACCESS_PAGE) {
    await supabase.auth.signOut()
    return { error: "Your password was set, but your account is not active. Contact your administrator." }
  }
  redirect(landing)
}
