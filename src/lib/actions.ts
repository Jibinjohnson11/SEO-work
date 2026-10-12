import { ActionError } from "@/lib/auth"
import { MissingConfigError } from "@/lib/server-env"
import { ZodError } from "zod"

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

interface PgLikeError {
  message?: string
  code?: string
  details?: string
}

/** Turns database / validation errors into messages that are safe and useful to show. */
export function describeError(error: unknown): string {
  if (error instanceof ActionError || error instanceof MissingConfigError) return error.message
  if (error instanceof ZodError) return error.issues.map((i) => i.message).join(". ")
  const e = error as PgLikeError
  switch (e?.code) {
    case "42501":
      return /row-level security|permission denied/i.test(e.message ?? "")
        ? "You do not have permission to do that."
        : (e.message ?? "Not allowed.")
    case "23505":
      return /already/i.test(e.message ?? "") ? e.message! : "A record with these details already exists."
    case "23503":
      return "This record is still referenced elsewhere. Archive it instead of deleting."
    case "23514":
    case "22023":
    case "P0002":
    case "40001":
      return e.message ?? "Invalid request."
    case "22P02":
      return "One of the values has an invalid format."
  }
  if (e?.message) return e.message
  return "Something went wrong. Please try again."
}

export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn()
    return { ok: true, data, message }
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_"
        ;(fieldErrors[key] ??= []).push(issue.message)
      }
      return { ok: false, error: describeError(error), fieldErrors }
    }
    // Next.js uses thrown errors for redirect()/notFound(); let those through.
    if (error && typeof error === "object" && "digest" in error) throw error
    console.error("[action]", error)
    return { ok: false, error: describeError(error) }
  }
}

/** Unwraps a Supabase response, throwing its error so run() can describe it. */
export function must<R extends { error: unknown }>(res: R): NonNullable<R extends { data: infer D } ? D : never> {
  if (res.error) throw res.error
  return (res as unknown as { data: unknown }).data as NonNullable<R extends { data: infer D } ? D : never>
}
