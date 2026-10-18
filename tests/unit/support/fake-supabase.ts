// In-memory stand-in for the parts of Supabase that inviteUser() touches, with the same guarantees
// the real services give: one Auth account per email (GoTrue), profiles keyed by the account id with
// a unique email (Postgres 23505), memberships/assignments that reference profiles, and an account
// that cannot be deleted while a profile references it (on delete restrict). Every call yields to
// the event loop first, so concurrent invitations genuinely interleave.

export type AuthUser = { id: string; email: string; email_confirmed_at: string | null; last_sign_in_at: string | null; app_metadata: Record<string, unknown>; created_at: string }
type Row = Record<string, unknown>
type PgError = { message: string; code?: string }
export type Hooks = Partial<Record<string, (arg: Row) => Promise<void> | void>>

const tick = () => new Promise<void>((r) => setImmediate(r))

export function fakeSupabase() {
  let seq = 0
  const state = {
    users: [] as AuthUser[],
    tables: { profiles: [] as Row[], client_members: [] as Row[], intern_assignments: [] as Row[] } as Record<string, Row[]>,
    emails: [] as { kind: "invite" | "recovery"; to: string }[],
    log: [] as string[],
    hooks: {} as Hooks,
    fail: {} as Record<string, PgError | undefined>,
  }
  const hook = async (name: string, arg: Row = {}) => {
    await tick()
    await state.hooks[name]?.(arg)
  }
  const failure = (name: string) => {
    const f = state.fail[name]
    if (f) state.log.push(`FAILED ${name}`)
    return f ?? null
  }

  function filterRows(rows: Row[], filters: [string, string, unknown][]) {
    return rows.filter((r) => filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : (v as unknown[]).includes(r[col]))))
  }

  function table(name: string) {
    const rows = () => state.tables[name]
    const filtered = (run: (filters: [string, string, unknown][]) => Promise<unknown>) => {
      const filters: [string, string, unknown][] = []
      const q = {
        eq(col: string, v: unknown) {
          filters.push(["eq", col, v])
          return q
        },
        in(col: string, v: unknown[]) {
          filters.push(["in", col, v])
          return q
        },
        maybeSingle: async () => {
          await tick()
          return { data: filterRows(rows(), filters)[0] ?? null, error: null }
        },
        single: async () => {
          await tick()
          const r = filterRows(rows(), filters)
          return r.length === 1 ? { data: r[0], error: null } : { data: null, error: { message: "not found", code: "PGRST116" } }
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => run(filters).then(ok, ko),
      }
      return q
    }
    return {
      select: () => filtered(async (filters) => {
        await tick()
        return { data: filterRows(rows(), filters), error: null }
      }),
      insert: async (input: Row | Row[]) => {
        const list = Array.isArray(input) ? input : [input]
        await hook(`insert ${name}`, list[0])
        const f = failure(`insert ${name}`)
        if (f) return { data: null, error: f }
        for (const row of list) {
          if (name === "profiles") {
            if (!state.users.some((u) => u.id === row.id)) return { data: null, error: { message: "violates foreign key profiles_id_fkey", code: "23503" } }
            if (rows().some((p) => p.id === row.id || String(p.email).toLowerCase() === String(row.email).toLowerCase()))
              return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }
          } else {
            const ref = name === "client_members" ? row.user_id : row.intern_id
            if (!state.tables.profiles.some((p) => p.id === ref)) return { data: null, error: { message: `violates foreign key on ${name}`, code: "23503" } }
          }
        }
        rows().push(...list.map((r) => ({ ...r })))
        state.log.push(`insert ${name}${name === "profiles" ? ` ${list[0].full_name}` : ""}`)
        return { data: null, error: null }
      },
      delete: () => filtered(async (filters) => {
        await hook(`delete ${name}`)
        const f = failure(`delete ${name}`)
        if (f) return { error: f }
        const doomed = filterRows(rows(), filters)
        if (name === "profiles") {
          const referenced = doomed.some((p) => state.tables.client_members.some((m) => m.user_id === p.id) || state.tables.intern_assignments.some((a) => a.intern_id === p.id))
          if (referenced) return { error: { message: "still referenced", code: "23503" } }
        }
        state.tables[name] = rows().filter((r) => !doomed.includes(r))
        state.log.push(`delete ${name} (${doomed.length})`)
        return { error: null }
      }),
    }
  }

  const findByEmail = (email: string) => state.users.find((u) => u.email === email.toLowerCase())

  const adminAuth = {
    listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
      await hook("listUsers")
      return { data: { users: state.users.slice((page - 1) * perPage, page * perPage).map((u) => ({ ...u })) }, error: null }
    },
    createUser: async (attrs: { email: string }) => {
      await hook("createUser", attrs)
      const f = failure("createUser")
      if (f) return { data: { user: null }, error: f }
      if (findByEmail(attrs.email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } }
      const user: AuthUser = { id: `acct-${++seq}`, email: attrs.email.toLowerCase(), email_confirmed_at: null, last_sign_in_at: null, app_metadata: {}, created_at: new Date().toISOString() }
      state.users.push(user)
      state.log.push(`create account ${user.id}`)
      return { data: { user: { ...user } }, error: null }
    },
    inviteUserByEmail: async (email: string) => {
      await hook("inviteUserByEmail", { email })
      const f = failure("inviteUserByEmail")
      if (f) return { data: { user: null }, error: f }
      let user = findByEmail(email)
      if (user?.email_confirmed_at) return { data: { user: null }, error: { message: "A user with this email address has already been registered", code: "email_exists", status: 422 } }
      if (!user) {
        user = { id: `acct-${++seq}`, email: email.toLowerCase(), email_confirmed_at: null, last_sign_in_at: null, app_metadata: {}, created_at: new Date().toISOString() }
        state.users.push(user)
      }
      state.emails.push({ kind: "invite", to: email })
      state.log.push(`email invite`)
      return { data: { user: { ...user } }, error: null }
    },
    updateUserById: async (id: string, attrs: { app_metadata: Record<string, unknown> }) => {
      await hook("updateUserById", attrs.app_metadata)
      const f = failure(`updateUserById ${attrs.app_metadata.role}`)
      if (f) return { data: { user: null }, error: f }
      const u = state.users.find((x) => x.id === id)
      if (!u) return { data: { user: null }, error: { message: "User not found" } }
      // GoTrue merges app_metadata; a null value removes the key.
      for (const [k, v] of Object.entries(attrs.app_metadata)) {
        if (v === null) delete u.app_metadata[k]
        else u.app_metadata[k] = v
      }
      state.log.push(`role ${id}=${attrs.app_metadata.role}`)
      return { data: { user: { ...u } }, error: null }
    },
    deleteUser: async (id: string) => {
      await hook("deleteUser", { id })
      state.log.push(`deleteUser attempt ${id}`) // recorded even when the database would refuse it
      if (state.tables.profiles.some((p) => p.id === id)) return { error: { message: "Database error deleting user" } } // on delete restrict
      state.users = state.users.filter((u) => u.id !== id)
      state.log.push(`DELETE ACCOUNT ${id}`)
      return { error: null }
    },
    getUserById: async (id: string) => {
      await tick()
      const u = state.users.find((x) => x.id === id)
      return u ? { data: { user: { ...u } }, error: null } : { data: { user: null }, error: { message: "User not found" } }
    },
  }

  const client = {
    from: table,
    auth: {
      admin: adminAuth,
      resetPasswordForEmail: async (email: string) => {
        await hook("resetPasswordForEmail", { email })
        const f = failure("resetPasswordForEmail")
        if (f) return { error: f }
        state.emails.push({ kind: "recovery", to: email })
        state.log.push("email recovery")
        return { error: null }
      },
    },
  }
  return { state, client }
}
