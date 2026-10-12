"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, NativeSelect } from "@/components/shared/form"
import { useAction } from "@/hooks/use-action"
import { publicationSchema } from "@/lib/validation"
import { recordPublication } from "@/server/workflow"

export function PublicationForm({ submissionId, anchorText, linkAttribute, today }: { submissionId: string; anchorText: string | null; linkAttribute: string | null; today: string }) {
  const { pending, execute } = useAction()
  const form = useForm<z.input<typeof publicationSchema>, unknown, z.output<typeof publicationSchema>>({
    resolver: zodResolver(publicationSchema),
    defaultValues: { published_url: "", publication_date: today, link_attribute: (linkAttribute as "dofollow") ?? "unknown", anchor_text: anchorText ?? "" },
  })
  const e = form.formState.errors
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => execute(() => recordPublication(submissionId, v)))}>
      <p className="text-xs text-muted-foreground">Record the live URL once the approved content is actually published. It will be verified separately — publication alone does not count as a verified backlink.</p>
      <Field label="Published URL" required error={e.published_url?.message} htmlFor="published_url"><Input id="published_url" placeholder="https://publisher.com/article" {...form.register("published_url")} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Publication date" required error={e.publication_date?.message} htmlFor="publication_date"><Input id="publication_date" type="date" max={today} {...form.register("publication_date")} /></Field>
        <Field label="Link attribute" htmlFor="link_attribute">
          <NativeSelect id="link_attribute" {...form.register("link_attribute")}>
            {["dofollow", "nofollow", "sponsored", "ugc", "unknown"].map((a) => <option key={a} value={a}>{a}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Anchor text used" htmlFor="pub_anchor"><Input id="pub_anchor" {...form.register("anchor_text")} /></Field>
      </div>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record publication"}</Button></div>
    </form>
  )
}
