import { describe, expect, it } from "vitest"
import { accountsWithoutProfile, findAuthUserByEmail } from "@/server/admin/auth-accounts"

const user = (i: number, extra: Record<string, unknown> = {}) => ({ id: `u${i}`, email: `user${i}@resend.dev`, created_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, ...extra })
function fakeAdmin(users: Record<string, unknown>[]) {
  const pages: number[] = []
  return {
    pages,
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          pages.push(page)
          return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }
        },
      },
    },
  } as never as Parameters<typeof findAuthUserByEmail>[0] & { pages: number[] }
}

describe("sign-in account lookup (Admin API)", () => {
  it("finds an account case-insensitively across pages", async () => {
    const admin = fakeAdmin(Array.from({ length: 1500 }, (_, i) => user(i)))
    expect((await findAuthUserByEmail(admin, " USER1234@Resend.dev "))?.id).toBe("u1234")
    expect(admin.pages).toEqual([1, 2])
  })
  it("returns null when no account exists", async () => {
    expect(await findAuthUserByEmail(fakeAdmin([user(1)]), "nobody@resend.dev")).toBeNull()
  })
  it("lists only accounts without a profile, newest first", async () => {
    const admin = fakeAdmin([user(1), user(2, { invited_at: "2026-10-03T00:00:00Z" }), user(3, { email_confirmed_at: "2026-10-04T00:00:00Z" })])
    const out = await accountsWithoutProfile(admin, new Set(["u1"]))
    expect(out.map((a) => [a.id, a.confirmed, a.invited_at])).toEqual([["u3", true, null], ["u2", false, "2026-10-03T00:00:00Z"]])
  })
})
