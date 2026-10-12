"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ActionResult } from "@/lib/actions"

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
        const result = await action()
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
