"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import type { BulkProps } from "@/components/shared/data-table"
import { useAction } from "@/hooks/use-action"
import { manualVerify, verifyNow } from "@/server/workflow"

export function VerifyNowButton({ ids, label = "Verify now", size = "sm" }: { ids: string[]; label?: string; size?: "sm" | "xs" }) {
  const { pending, execute } = useAction()
  return (
    <Button size={size} variant="outline" disabled={pending || ids.length === 0} onClick={() => execute(() => verifyNow(ids), { success: "Verification finished" })}>
      <RefreshCw className={pending ? "animate-spin" : undefined} /> {pending ? "Checking…" : label}
    </Button>
  )
}

export function VerifyBulk({ selectedIds = [], clear }: BulkProps) {
  const { pending, execute } = useAction()
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => execute(() => verifyNow(selectedIds.slice(0, 50)), { onSuccess: () => clear?.(), success: "Verification finished" })}>
      <RefreshCw className={pending ? "animate-spin" : undefined} /> {pending ? "Checking…" : `Verify ${Math.min(selectedIds.length, 50)} now`}
    </Button>
  )
}

export function ManualVerifyButton({ publishedId, size = "sm" }: { publishedId: string; size?: "sm" | "xs" }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<"live" | "changed" | "missing" | "unreachable">("live")
  const [notes, setNotes] = useState("")
  const { pending, execute } = useAction()
  return (
    <>
      <Button size={size} variant="ghost" onClick={() => setOpen(true)}>Manual check</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Record manual verification" description="Use when the automated check is inconclusive (e.g. blocked by robots.txt or rendered by JavaScript).">
        <div className="space-y-4">
          <Field label="Result" htmlFor="mv-result">
            <NativeSelect id="mv-result" value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
              <option value="live">Live — link present to target</option>
              <option value="changed">Changed — link present but anchor/attribute differs</option>
              <option value="missing">Missing — link not on page</option>
              <option value="unreachable">Unreachable — page not available</option>
            </NativeSelect>
          </Field>
          <Field label="Evidence / notes" required htmlFor="mv-notes" hint="What you checked and how (screenshot location, view-source, etc.)">
            <Textarea id="mv-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FormActions>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || notes.trim().length < 5} onClick={async () => { const r = await execute(() => manualVerify(publishedId, { result, notes })); if (r.ok) setOpen(false) }}>Save result</Button>
          </FormActions>
        </div>
      </FormDialog>
    </>
  )
}
