import "server-only"
import { serverEnv } from "@/lib/server-env"

export function isEmailConfigured() {
  return Boolean(serverEnv.resendApiKey && serverEnv.emailFrom)
}

/** Sends through Resend's HTTP API. Returns false (never pretends success) when not configured. */
export async function sendEmail(msg: {
  to: string[]
  subject: string
  text: string
  attachments?: { filename: string; content: Buffer }[]
}): Promise<boolean> {
  if (!isEmailConfigured() || msg.to.length === 0) return false
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: serverEnv.emailFrom,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
    }),
  })
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}
