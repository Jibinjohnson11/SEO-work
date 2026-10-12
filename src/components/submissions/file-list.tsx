"use client"

import { useRef } from "react"
import { Download, Paperclip, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import { getFileUrl, removeSubmissionFile, uploadSubmissionFiles } from "@/server/workflow"
import { toast } from "sonner"

export interface FileItem {
  id: string
  file_name: string
  size_bytes: number | null
  created_at: string
}

export function FileList({ submissionId, files, canEdit }: { submissionId: string; files: FileItem[]; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const { pending, execute } = useAction()
  return (
    <div className="space-y-2">
      {files.length === 0 ? <p className="text-sm text-muted-foreground">No supporting files.</p> : (
        <ul className="divide-y rounded-lg border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Paperclip className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
              <span className="text-xs text-muted-foreground">{f.size_bytes ? `${Math.ceil(f.size_bytes / 1024)} KB` : ""}</span>
              <Button size="icon-sm" variant="ghost" aria-label={`Download ${f.file_name}`} onClick={async () => {
                const r = await getFileUrl(f.id)
                if (r.ok && r.data) window.location.href = r.data
                else toast.error(r.ok ? "Could not create link" : r.error)
              }}><Download /></Button>
              {canEdit ? <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.file_name}`} disabled={pending} onClick={() => execute(() => removeSubmissionFile(f.id))}><Trash2 /></Button> : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex items-center gap-2"
        >
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const fd = new FormData()
              fd.set("submission_id", submissionId)
              for (const f of Array.from(e.target.files ?? [])) fd.append("files", f)
              e.target.value = ""
              execute(() => uploadSubmissionFiles(fd))
            }}
          />
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => input.current?.click()}><Upload /> {pending ? "Uploading…" : "Upload files"}</Button>
          <span className="text-xs text-muted-foreground">PDF, images, Office docs · max 10 MB each</span>
        </form>
      ) : null}
    </div>
  )
}
