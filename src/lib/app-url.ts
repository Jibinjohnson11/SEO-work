import "server-only"
import { headers } from "next/headers"
import { publicEnv } from "@/lib/env"
import { MissingConfigError } from "@/lib/server-env"

/**
 * Public origin used in emailed links (invitations, confirmations, password resets).
 * In production it must come from NEXT_PUBLIC_APP_URL: deriving it from the request's Host
 * header would let a forged header choose where those links point.
 */
export async function appOrigin() {
  if (publicEnv.appUrl) return publicEnv.appUrl.replace(/\/$/, "")
  if (process.env.NODE_ENV === "production") throw new MissingConfigError(["NEXT_PUBLIC_APP_URL"], "Sending email links")
  const h = await headers()
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`
}
