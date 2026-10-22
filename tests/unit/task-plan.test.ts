import { describe, expect, it } from "vitest"
import { splitTarget, taskTitle } from "@/lib/task-plan"

describe("splitTarget", () => {
  it("gives every member the full target per member", () => {
    expect(splitTarget(5, 3, "each")).toEqual([5, 5, 5])
  })

  it("splits a shared target so members add up to exactly the total", () => {
    expect(splitTarget(10, 3, "shared")).toEqual([4, 3, 3])
    expect(splitTarget(3, 3, "shared")).toEqual([1, 1, 1])
  })
})

describe("taskTitle", () => {
  it("names the task from keyword and type, marking shared targets", () => {
    expect(taskTitle("crm software", "Guest post")).toBe("crm software · Guest post")
    expect(taskTitle("crm software", null, 10)).toBe("crm software · Backlinks · shared 10")
  })
})
