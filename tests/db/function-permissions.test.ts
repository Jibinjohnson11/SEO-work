import { beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { asService, asSystem, asUser, createDb, createUser, type Db } from "./harness"

// Who may EXECUTE the LinkOps database functions (regression: before
// 20261016000014_function_execute_lockdown.sql, functions created after migration 3 were
// executable by PUBLIC, i.e. by anonymous visitors holding only the public API key).

let db: Db
const ids: Record<string, string> = {}

/**
 * Functions only the server calls with the service-role key; signed-in users must not reach them.
 * (notify_due_tasks is also run by the daily job, but a Super Admin may run it too; it rejects
 * everyone else internally.)
 */
const SERVICE_ONLY = new Set(["check_rate_limit", "purge_rate_limits"])

/** Every function name the app calls through supabase.rpc(), read from the source. */
function appRpcNames() {
  const names = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry)) for (const m of readFileSync(path, "utf8").matchAll(/\.rpc\("([a-z_]+)"/g)) names.add(m[1])
    }
  }
  walk(join(__dirname, "..", "..", "src"))
  return [...names].sort()
}

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows
}
async function fails(sql: string, params: unknown[], pattern: RegExp) {
  await expect(db.query(sql, params)).rejects.toThrow(pattern)
}
async function asAnon() {
  await asSystem(db)
  await db.exec("set role anon")
}
/** Names of public functions the given role can execute (via any grant, including PUBLIC). */
async function executableBy(role: string) {
  await asSystem(db)
  return (
    await rows<{ name: string }>(
      `select distinct p.proname as name from pg_proc p
       where p.pronamespace = 'public'::regnamespace and has_function_privilege($1, p.oid, 'execute') order by 1`,
      [role],
    )
  ).map((r) => r.name)
}

beforeAll(async () => {
  db = await createDb()
  ids.admin = await createUser(db, "super_admin", "Owner Admin")
  ids.intern = await createUser(db, "intern", "Intern User")
  ids.client = await createUser(db, "client", "Client User")
})

describe("anonymous access", () => {
  it("anonymous visitors can execute no LinkOps function", async () => {
    expect(await executableBy("anon")).toEqual([])
  })

  it("no function grants EXECUTE to PUBLIC", async () => {
    await asSystem(db)
    const r = await rows(
      `select p.oid::regprocedure::text as fn from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.pronamespace = 'public'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'`,
    )
    expect(r).toEqual([])
  })

  it("the database refuses anonymous calls before any function code runs", async () => {
    await asAnon()
    await fails("select my_permissions()", [], /permission denied for function my_permissions/)
    await asAnon()
    await fails("select approve_registration($1, 'intern', null)", [randomUUID()], /permission denied for function approve_registration/)
    await asAnon()
    await fails("select * from client_portal_campaigns()", [], /permission denied for function client_portal_campaigns/)
    await asAnon()
    await fails("select check_rate_limit('login:email:victim@example.test', 1, 0)", [], /permission denied for function check_rate_limit/)
  })
})

describe("signed-in access", () => {
  it("signed-in users can execute every function the app calls on their behalf", async () => {
    const callable = new Set(await executableBy("authenticated"))
    const missing = appRpcNames().filter((n) => !SERVICE_ONLY.has(n) && !callable.has(n))
    expect(missing).toEqual([])
  })

  it("signed-in users cannot reach the server-only functions", async () => {
    const callable = new Set(await executableBy("authenticated"))
    expect([...SERVICE_ONLY].filter((n) => callable.has(n))).toEqual([])
  })

  it("internal helpers (_impl, _require_*) stay unreachable for signed-in users", async () => {
    expect((await executableBy("authenticated")).filter((n) => n.startsWith("_"))).toEqual([])
  })

  it("authorization inside functions still decides what each role may do", async () => {
    const missingReport = randomUUID()
    await asUser(db, ids.intern)
    await fails("select report_set_published($1, true)", [missingReport], /Super Admin access required/)
    await asUser(db, ids.client)
    await fails("select approve_registration($1, 'intern', null)", [randomUUID()], /Only a Super Admin/)
    await asUser(db, ids.intern)
    await fails("select * from client_portal_campaigns()", [], /Client access required/)
  })
})

describe("admin access", () => {
  it("the Super Admin can still execute admin functions (reaching their own checks)", async () => {
    await asUser(db, ids.admin)
    await fails("select report_set_published($1, true)", [randomUUID()], /Report not found/)
    await fails("select approve_registration($1, 'intern', null)", [randomUUID()], /User not found/)
    expect((await rows<{ p: string[] }>("select my_permissions() as p"))[0].p).toEqual(["*"])
  })
})

describe("service-role access", () => {
  it("the service role can execute every function the server calls", async () => {
    const callable = new Set(await executableBy("service_role"))
    expect(appRpcNames().filter((n) => !callable.has(n))).toEqual([])
  })

  it("the service role runs the daily job and the rate limiter", async () => {
    await asService(db)
    expect((await rows("select check_rate_limit('svc-test', 5, 60) as ok"))[0]).toEqual({ ok: true })
    expect(typeof (await rows<{ n: number }>("select purge_rate_limits() as n"))[0].n).toBe("number")
    await rows("select notify_due_tasks(2)")
  })
})

describe("functions created in future migrations", () => {
  it("start locked: no PUBLIC, anon or authenticated EXECUTE; service role only", async () => {
    await asSystem(db)
    await db.exec("create function public.__probe_new_function() returns integer language sql as 'select 1'")
    try {
      const r = await rows(
        `select has_function_privilege('anon', 'public.__probe_new_function()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.__probe_new_function()', 'execute') as authenticated,
                has_function_privilege('service_role', 'public.__probe_new_function()', 'execute') as service_role,
                exists (select 1 from aclexplode((select proacl from pg_proc where oid = 'public.__probe_new_function()'::regprocedure)) a
                        where a.grantee = 0) as public_grant`,
      )
      expect(r[0]).toEqual({ anon: false, authenticated: false, service_role: true, public_grant: false })
    } finally {
      await asSystem(db)
      await db.exec("drop function public.__probe_new_function()")
    }
  })
})
