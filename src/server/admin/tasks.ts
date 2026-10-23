"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ActionError, authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { todayIn } from "@/lib/reporting"
import { splitTarget, taskTitle } from "@/lib/task-plan"
import { blankToNull, taskSchema, taskUpdateSchema, type TaskInput, type TaskUpdateInput } from "@/lib/validation"
import { getSetting } from "@/server/queries"
import { assignableMembers } from "@/server/task-members"

const id = z.string().uuid()

/**
 * Creates one task per selected team member for a brand → campaign → keyword. Title, start date
 * (today in the reporting time zone) and priority (the table default) are set automatically.
 */
export async function createTasks(input: TaskInput) {
  return run(async () => {
    const v = taskSchema.parse(input)
    const { supabase, userId } = await authorize(["super_admin"])
    const [campaign, link, type, members, { timezone }] = await Promise.all([
      supabase.from("campaigns").select("id, status").eq("id", v.campaign_id).eq("client_id", v.client_id).maybeSingle(),
      supabase.from("campaign_keywords").select("keywords(keyword)").eq("campaign_id", v.campaign_id).eq("keyword_id", v.keyword_id).maybeSingle(),
      v.backlink_type_id ? supabase.from("backlink_types").select("name").eq("id", v.backlink_type_id).maybeSingle() : Promise.resolve({ data: null }),
      assignableMembers(supabase),
      getSetting("reports"),
    ])
    if (!campaign.data) throw new ActionError("That campaign does not belong to the selected brand")
    if (campaign.data.status !== "active") throw new ActionError("Work can only be assigned for active campaigns. Activate the campaign first.")
    const keyword = (link.data?.keywords as unknown as { keyword: string } | null)?.keyword
    if (!keyword) throw new ActionError("That keyword is not part of the selected campaign")
    const names = new Map(members.map((m) => [m.id, m.label]))
    const internIds = [...new Set(v.intern_ids)]
    if (internIds.some((i) => !names.has(i))) throw new ActionError("One of the selected team members can no longer receive tasks")

    const today = todayIn(timezone)
    if (v.due_date && v.due_date < today) throw new ActionError("The deadline cannot be in the past")

    // Duplicate guard: the same open work (member, campaign, keyword, type, frequency) is never assigned twice.
    let dup = supabase
      .from("tasks")
      .select("intern_id")
      .eq("campaign_id", v.campaign_id)
      .eq("keyword_id", v.keyword_id)
      .eq("cadence", v.cadence)
      .in("intern_id", internIds)
      .not("status", "in", "(completed,cancelled)")
    dup = v.backlink_type_id ? dup.eq("backlink_type_id", v.backlink_type_id) : dup.is("backlink_type_id", null)
    const existing = must(await dup) as { intern_id: string }[]
    if (existing.length) {
      const who = [...new Set(existing.map((t) => names.get(t.intern_id) ?? "a team member"))].join(", ")
      throw new ActionError(`Already assigned (open task with the same keyword, type and frequency): ${who}`)
    }

    const shared = v.target_mode === "shared" && internIds.length > 1
    const quantities = splitTarget(v.target_quantity, internIds.length, shared ? "shared" : "each")
    const title = taskTitle(keyword, type.data?.name ?? null, shared ? v.target_quantity : undefined)
    const rows = internIds.map((intern_id, i) => ({
      title,
      intern_id,
      campaign_id: v.campaign_id,
      keyword_id: v.keyword_id,
      backlink_type_id: v.backlink_type_id || null,
      cadence: v.cadence,
      target_quantity: quantities[i],
      start_date: today,
      due_date: v.due_date || null,
      instructions: v.instructions || null,
      created_by: userId,
    }))
    must(await supabase.from("tasks").insert(rows))
    revalidatePath("/admin/tasks")
    return rows.length
  })
}

export async function updateTask(taskId: string, input: TaskUpdateInput) {
  return run(async () => {
    const data = blankToNull(taskUpdateSchema.parse(input))
    const { supabase } = await authorize(["super_admin"])
    must(await supabase.from("tasks").update(data).eq("id", id.parse(taskId)))
    revalidatePath("/admin/tasks")
  }, "Task updated")
}

export async function bulkTaskAction(
  taskIds: string[],
  action: { type: "status"; status: TaskUpdateInput["status"] } | { type: "reassign"; internId: string } | { type: "due"; dueDate: string },
) {
  return run(async () => {
    const ids = z.array(id).min(1).parse(taskIds)
    const { supabase } = await authorize(["super_admin"])
    // Same rule as createTasks: only members who can receive tasks (active or invited, with My Tasks).
    if (action.type === "reassign" && !(await assignableMembers(supabase)).some((m) => m.id === action.internId))
      throw new ActionError("That team member can no longer receive tasks")
    const patch =
      action.type === "status"
        ? { status: taskUpdateSchema.shape.status.parse(action.status) }
        : action.type === "reassign"
          ? { intern_id: id.parse(action.internId) }
          : { due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(action.dueDate) }
    must(await supabase.from("tasks").update(patch).in("id", ids))
    revalidatePath("/admin/tasks")
  }, "Tasks updated")
}

export async function deleteTask(taskId: string) {
  return run(async () => {
    const { supabase } = await authorize(["super_admin"])
    const tid = id.parse(taskId)
    // A failed count must not fall through to delete: submissions would silently lose their task link.
    const { count, error } = await supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("task_id", tid)
    if (error) throw error
    if (count) must(await supabase.from("tasks").update({ status: "cancelled" }).eq("id", tid))
    else must(await supabase.from("tasks").delete().eq("id", tid))
    revalidatePath("/admin/tasks")
    return count ? "cancelled" : "deleted"
  })
}
