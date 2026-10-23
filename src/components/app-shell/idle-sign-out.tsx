"use client"

import { useEffect } from "react"
import { signOut } from "@/server/auth-actions"

const STORAGE_KEY = "linkops:last-activity"

/**
 * Signs the user out after a period of inactivity (Settings → Security). The last activity time is
 * shared between tabs through localStorage, so working in one tab keeps the others signed in too.
 * Without storage (private mode, blocked site data) each tab falls back to its own activity.
 */
export function IdleSignOut({ minutes }: { minutes: number }) {
  useEffect(() => {
    const limit = minutes * 60_000
    let last = Date.now()
    const write = () => {
      try {
        localStorage.setItem(STORAGE_KEY, String(last))
      } catch {
        // storage unavailable: this tab's own activity still counts
      }
    }
    const latest = () => {
      try {
        const shared = Number(localStorage.getItem(STORAGE_KEY))
        return Number.isFinite(shared) && shared > last ? shared : last
      } catch {
        return last
      }
    }
    const onActivity = () => {
      const now = Date.now()
      if (now - last < 5_000) return // mousemove fires constantly; a few seconds of precision is enough
      last = now
      write()
    }
    write()
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const timer = setInterval(() => {
      last = latest()
      if (Date.now() - last >= limit) {
        clearInterval(timer)
        void signOut()
      }
    }, Math.min(30_000, limit))
    return () => {
      clearInterval(timer)
      events.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [minutes])
  return null
}
