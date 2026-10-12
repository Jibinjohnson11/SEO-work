"use client"

import { useEffect } from "react"
import { signOut } from "@/server/auth-actions"

/** Signs the user out after a period of inactivity (Settings → Security). */
export function IdleSignOut({ minutes }: { minutes: number }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void signOut(), minutes * 60_000)
    }
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [minutes])
  return null
}
