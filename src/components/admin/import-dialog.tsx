"use client"

import { useState } from "react"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import type { ActionResult } from "@/lib/actions"

interface ImportResult {
  created: number
  updated: number
  errors: { row: number; message: string }[]
}

export function ImportDialog({
  title,
  columns,
  example,
  action,
}: {
  title: string
  columns: string[]
  example: string[]
  action: (fd: FormData) => Promise<ActionResult<ImportResult>>
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const { pending, execute } = useAction()
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(`${columns.join(",")}\n${example.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")}\n`)}`
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setResult(null); setOpen(true) }}>
        <Upload /> Import
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={title} description="Upload a .csv or .xlsx file. The first row must contain the column names.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            const r = await execute(() => action(fd), { onSuccess: (d) => setResult(d ?? null) })
            if (r.ok && r.data && r.data.errors.length === 0) setOpen(false)
          }}
        >
          <div className="rounded-lg bg-muted p-3 text-xs">
            <p className="mb-1 font-medium">Columns</p>
            <p className="font-mono break-words text-muted-foreground">{columns.join(", ")}</p>
            <a href={template} download="import-template.csv" className="mt-2 inline-block text-primary hover:underline">Download template</a>
          </div>
          <Input type="file" name="file" accept=".csv,.xlsx" required />
          {result ? (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p>{result.created} created · {result.updated} updated · {result.errors.length} rows with errors</p>
              {result.errors.length ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-destructive">
                  {result.errors.map((er) => (
                    <li key={er.row}>Row {er.row}: {er.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <FormActions>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button type="submit" disabled={pending}>{pending ? "Importing…" : "Import"}</Button>
          </FormActions>
        </form>
      </FormDialog>
    </>
  )
}
