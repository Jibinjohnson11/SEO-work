"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { newCampaignSchema } from "@/lib/validation"
import { createCampaign } from "@/server/admin/campaigns"
import type { CampaignFormOptions } from "@/components/admin/campaign-form"
import { BRAND_KEYWORDS_LIST, BrandKeywordList, KeywordTags } from "@/components/admin/keyword-inputs"

type Values = z.input<typeof newCampaignSchema>

/**
 * Simplified campaign creation. Priority, allowed backlink types, description and notes are not asked
 * here: they take the configured default priority, all active types and blank text, and stay editable
 * in the full CampaignForm used for editing.
 */
export function NewCampaignForm({ options, presetClientId, onDone }: { options: CampaignFormOptions; presetClientId?: string; onDone: () => void }) {
  const router = useRouter()
  const { pending, execute } = useAction()
  const form = useForm<Values, unknown, z.output<typeof newCampaignSchema>>({
    resolver: zodResolver(newCampaignSchema),
    defaultValues: {
      client_id: presetClientId ?? "",
      primary_keyword: "",
      secondary_keywords: [],
      target_url: "",
      status: "active",
      backlink_type_ids: [],
      priority: options.defaults.priority as Values["priority"],
      description: "",
      internal_notes: "",
    },
  })
  const e = form.formState.errors
  const [clientId, primary] = useWatch({ control: form.control, name: ["client_id", "primary_keyword"] })
  const brandKeywords = useMemo(() => options.keywords.filter((k) => k.client_id === clientId).map((k) => k.keyword), [options.keywords, clientId])

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit(async (v) => {
        const r = await execute(() => createCampaign(v))
        if (r.ok) {
          onDone()
          if (r.data) router.push(`/admin/campaigns/${r.data}`)
        }
      })}
    >
      <div className="grid gap-4">
        <Field label="Primary keyword" required error={e.primary_keyword?.message} htmlFor="primary_keyword" hint="Also used as the campaign name">
          <Input id="primary_keyword" list={BRAND_KEYWORDS_LIST} placeholder="e.g. Best Marketing Company" autoComplete="off" className="h-9" {...form.register("primary_keyword")} aria-invalid={!!e.primary_keyword} />
        </Field>
        <Field label="Secondary keywords" error={e.secondary_keywords?.message ?? e.secondary_keywords?.root?.message} htmlFor="secondary_keywords">
          <Controller control={form.control} name="secondary_keywords" render={({ field }) => (
            <KeywordTags id="secondary_keywords" value={field.value} onChange={field.onChange} exclude={primary} placeholder="Type and press Enter to add keywords..." />
          )} />
        </Field>
        <BrandKeywordList keywords={brandKeywords} />
        <Field label="Brand" required error={e.client_id?.message} htmlFor="client_id">
          <NativeSelect id="client_id" className="h-9" {...form.register("client_id")} aria-invalid={!!e.client_id}>
            <option value="">Choose a brand…</option>
            {options.clients.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Landing page URL" error={e.target_url?.message} htmlFor="target_url">
          <Input id="target_url" type="url" placeholder="e.g. https://example.com/page" className="h-9" {...form.register("target_url")} aria-invalid={!!e.target_url} />
        </Field>
        <Field label="Active" htmlFor="status" hint="No saves the campaign as a draft">
          <NativeSelect id="status" className="h-9" {...form.register("status")}>
            <option value="active">Yes</option>
            <option value="draft">No</option>
          </NativeSelect>
        </Field>
      </div>

      <div className="sticky -bottom-4 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-popover px-4 py-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create Campaign"}</Button>
      </div>
    </form>
  )
}
