"use client"

import { useState } from "react"
import { Download, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { ConfirmAction } from "@/components/shared/confirm-action"
import { useAction } from "@/hooks/use-action"
import { deleteReport, saveReportSnapshot, setReportPublished } from "@/server/admin/reports"

export function ReportToolbar({ query, defaultTitle, clientSelected }: { query: string; defaultTitle: string; clientSelected: boolean }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(defaultTitle)
  const { pending, execute } = useAction()
  const href = (format: string) => `/api/reports/export?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), format })}`
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" className="h-9" />}><Download /> Export</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={<a href={href("xlsx")} />}>Excel (.xlsx)</DropdownMenuItem>
          <DropdownMenuItem render={<a href={href("csv")} />}>CSV</DropdownMenuItem>
          <DropdownMenuItem render={<a href={href("pdf")} />}>PDF</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button className="h-9" onClick={() => { setTitle(defaultTitle); setOpen(true) }}><Save /> Save report</Button>
      <FormDialog open={open} onOpenChange={setOpen} title="Save report snapshot" description={clientSelected ? "Snapshots of a single client can be published to that client's portal." : "Tip: filter by one client to be able to publish this snapshot to their portal."}>
        <div className="space-y-4">
          <Field label="Title" htmlFor="snap-title"><Input id="snap-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <FormActions>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending || !title.trim()} onClick={async () => { const r = await execute(() => saveReportSnapshot(query, title)); if (r.ok) setOpen(false) }}>Save</Button>
          </FormActions>
        </div>
      </FormDialog>
    </>
  )
}

export function SnapshotActions({ id, status, hasClient }: { id: string; status: "draft" | "published"; hasClient: boolean }) {
  return (
    <span className="flex items-center justify-end gap-1">
      <a className="rounded-md px-2 py-1 text-xs hover:bg-muted" href={`/api/reports/${id}/download?format=pdf`}>PDF</a>
      <a className="rounded-md px-2 py-1 text-xs hover:bg-muted" href={`/api/reports/${id}/download?format=xlsx`}>Excel</a>
      <a className="rounded-md px-2 py-1 text-xs hover:bg-muted" href={`/api/reports/${id}/download?format=csv`}>CSV</a>
      {status === "draft" ? (
        <>
          {hasClient ? <ConfirmAction size="xs" variant="outline" title="Publish to client portal?" description="Client users of this workspace will see and be notified about this report." onConfirm={() => setReportPublished(id, true)}>Publish</ConfirmAction> : null}
          <ConfirmAction size="xs" variant="ghost" destructive title="Delete draft snapshot?" onConfirm={() => deleteReport(id)}>Delete</ConfirmAction>
        </>
      ) : (
        <ConfirmAction size="xs" variant="ghost" title="Unpublish report?" description="The client will no longer see it." onConfirm={() => setReportPublished(id, false)}>Unpublish</ConfirmAction>
      )}
    </span>
  )
}
