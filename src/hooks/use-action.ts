"use client"

import { useTransition } from "react"
import { unstable_rethrow, useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ActionResult } from "@/lib/actions"

const CONNECTION_ERROR = "Connection problem — your change may not have been saved. Check your connection and try again."

/** Runs a server action, shows a toast with the outcome and refreshes server data. */
export function useAction() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function execute<T>(
    action: () => Promise<ActionResult<T>>,
    opts: { success?: string; onSuccess?: (data: T | undefined) => void; refresh?: boolean } = {},
  ) {
    return new Promise<ActionResult<T>>((resolve) => {
      startTransition(async () => {
        let result: ActionResult<T>
        try {
          result = await action()
        } catch (error) {
          // Server actions return their own errors as results; a throw here means the request
          // itself failed (offline, timeout, server crash). Next.js redirects pass through.
          unstable_rethrow(error)
          console.error("[action] request failed", error)
          result = { ok: false, error: CONNECTION_ERROR }
        }
        if (result.ok) {
          const msg = result.message ?? opts.success
          if (msg) toast.success(msg)
          opts.onSuccess?.(result.data)
          if (opts.refresh !== false) router.refresh()
        } else {
          toast.error(result.error)
        }
        resolve(result)
      })
    })
  }

  return { pending, execute }
}
