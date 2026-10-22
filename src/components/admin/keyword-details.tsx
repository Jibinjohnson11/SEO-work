"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/shared/form"
import { FormActions, FormDialog } from "@/components/shared/form-dialog"
import { useAction } from "@/hooks/use-action"
import { humanize, SEARCH_INTENTS } from "@/lib/workflow"
import { updateKeywordDetails } from "@/server/admin/keywords"

/** Edit button for one keyword's target URL and search intent on the campaign page. */
export function KeywordDetailsButton({
  keywordId,
  campaignId,
  keyword,
  initial,
}: {
  keywordId: string
  campaignId: string
  keyword: string
  initial: { target_url: string | null; search_intent: string | null }
}) {
  const [open, setOpen] = useState(false)
  const [targetUrl, setTargetUrl] = useState(initial.target_url ?? "")
  const [intent, setIntent] = useState(initial.search_intent ?? "")
  const { pending, execute } = useAction()
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${keyword}`} onClick={() => setOpen(true)}>
        <Pencil />
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={`Edit “${keyword}”`} description="Shared by every campaign of this brand that uses the keyword.">
        <div className="space-y-4">
          <Field label="Target URL" hint="Pre-fills the target URL when team members submit for this keyword" htmlFor={`kw-url-${keywordId}`}>
            <Input id={`kw-url-${keywordId}`} value={targetUrl} placeholder="https://…" onChange={(e) => setTargetUrl(e.target.value)} />
          </Field>
          <Field label="Search intent" htmlFor={`kw-intent-${keywordId}`}>
            <NativeSelect id={`kw-intent-${keywordId}`} value={intent} onChange={(e) => setIntent(e.target.value)}>
              <option value="">Not set</option>
              {SEARCH_INTENTS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </NativeSelect>
          </Field>
          <FormActions>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={async () => {
                const r = await execute(() => updateKeywordDetails(keywordId, campaignId, { target_url: targetUrl.trim(), search_intent: intent as "" }))
                if (r.ok) setOpen(false)
              }}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </FormActions>
        </div>
      </FormDialog>
    </>
  )
}
