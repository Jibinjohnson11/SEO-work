"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { authorize } from "@/lib/auth"
import { must, run } from "@/lib/actions"
import { blankToNull, taskSchema, taskUpdateSchema, type TaskInput, type TaskUpdateInput } from "@/lib/validation"

const id = z.string().uuid()

/** Creates one task per (intern × campaign) pair — bulk assignment across campaigns and interns. */
export async function createTasks(input: TaskInput) {
  return run(async () => {
    const { intern_ids, campaign_ids, ...fields } = taskSchema.parse(input)
    if (intern_ids.length * campaign_ids.length > 500) throw new Error("That would create more than 500 tasks at once")
    const { supabase, userId } = await authorize(["super_admin"])
    const base = blankToNull(fields)
    const rows = intern_ids.flatMap((intern_id) =>
      campaign_ids.map((campaign_id) => ({ ...base, intern_id, campaign_id, created_by: userId })),
    )
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
    const { count } = await supabase.from("backlink_submissions").select("id", { count: "exact", head: true }).eq("task_id", taskId)
    if (count) {
      must(await supabase.from("tasks").update({ status: "cancelled" }).eq("id", id.parse(taskId)))
      return "cancelled"
    }
    must(await supabase.from("tasks").delete().eq("id", id.parse(taskId)))
    revalidatePath("/admin/tasks")
    return "deleted"
  })
}
