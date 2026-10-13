"use server"

import { z } from "zod"
import { authorize } from "@/lib/auth"
import { run } from "@/lib/actions"
import { can } from "@/lib/permissions"

export interface SearchHit {
  group: string
  label: string
  hint?: string
  href: string
}

/**
 * Role-aware global search. Every query runs as the user, so RLS limits the results, and only
 * features the user has been granted are searched.
 */
export async function globalSearch(raw: string) {
  return run(async () => {
    const q = z.string().trim().min(2).max(80).parse(raw).replace(/[%_,()*\\]/g, " ")
    const like = `%${q}%`
    const { supabase, profile, permissions } = await authorize(["super_admin", "intern", "client"])
    const hits: SearchHit[] = []

    if (profile.role === "client") {
      if (!can(permissions, "portal.approvals")) return hits
      const { data } = await supabase.rpc("client_portal_submissions", { p_queue_only: false })
      for (const s of (data ?? []) as { id: string; code: string; content_title: string | null; proposed_website: string; campaign_code: string }[]) {
        if (`${s.code} ${s.content_title} ${s.proposed_website} ${s.campaign_code}`.toLowerCase().includes(q.toLowerCase()))
          hits.push({ group: "Submissions", label: `${s.code} · ${s.content_title ?? s.proposed_website}`, hint: s.campaign_code, href: `/portal/approvals/${s.id}` })
      }
      return hits.slice(0, 20)
    }

    const base = profile.role === "super_admin" ? "/admin" : "/intern"
    const none = { data: [] as never[] }
    const [campaigns, submissions, keywords, tasks] = await Promise.all([
      can(permissions, "intern.campaigns")
        ? supabase.from("campaigns").select("id, code, name").or(`code.ilike.${like},name.ilike.${like}`).limit(6)
        : none,
      can(permissions, "intern.submissions")
        ? supabase.from("backlink_submissions").select("id, code, content_title, proposed_website").or(`code.ilike.${like},content_title.ilike.${like},proposed_website.ilike.${like},anchor_text.ilike.${like}`).limit(8)
        : none,
      can(permissions, "intern.campaigns")
        ? supabase.from("keywords").select("id, keyword, code").or(`keyword.ilike.${like},code.ilike.${like}`).limit(6)
        : none,
      can(permissions, "intern.tasks") ? supabase.from("tasks").select("id, code, title").or(`code.ilike.${like},title.ilike.${like}`).limit(6) : none,
    ])
    for (const c of campaigns.data ?? []) hits.push({ group: "Campaigns", label: `${c.code} · ${c.name}`, href: `${base}/campaigns/${c.id}` })
    for (const s of submissions.data ?? []) hits.push({ group: "Submissions", label: `${s.code} · ${s.content_title ?? s.proposed_website}`, href: `${base}/submissions/${s.id}` })
    for (const k of keywords.data ?? []) hits.push({ group: "Keywords", label: k.keyword, hint: k.code, href: profile.role === "super_admin" ? `/admin/keywords?q=${encodeURIComponent(k.keyword)}` : `/intern/campaigns` })
    for (const t of tasks.data ?? []) hits.push({ group: "Tasks", label: `${t.code} · ${t.title}`, href: profile.role === "super_admin" ? `/admin/tasks?q=${t.code}` : `/intern/tasks` })

    if (profile.role === "super_admin") {
      const [clients, interns, published] = await Promise.all([
        supabase.from("clients").select("id, code, company_name").or(`company_name.ilike.${like},code.ilike.${like}`).limit(6),
        supabase.from("profiles").select("id, full_name, email, role").or(`full_name.ilike.${like},email.ilike.${like}`).limit(6),
        supabase.from("published_backlinks").select("id, published_url, submission_id").ilike("published_url", like).limit(6),
      ])
      for (const c of clients.data ?? []) hits.push({ group: "Clients", label: c.company_name, hint: c.code, href: `/admin/clients/${c.id}` })
      for (const p of interns.data ?? [])
        hits.push({ group: p.role === "intern" ? "Interns" : "Users", label: p.full_name || p.email, hint: p.email, href: p.role === "intern" ? `/admin/interns/${p.id}` : `/admin/settings?tab=users` })
      for (const p of published.data ?? []) hits.push({ group: "Published backlinks", label: p.published_url, href: `/admin/submissions/${p.submission_id}` })
    }
    return hits
  })
}
