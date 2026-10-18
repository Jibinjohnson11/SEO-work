import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

// Minimal stand-ins for the parts of Supabase the migrations depend on.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant select, insert, delete on storage.objects to authenticated;
`

export const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations")

export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB)
  // Supabase gives service_role EXECUTE on functions the migration role creates in public through
  // default privileges (not a blanket grant afterwards), so tests see the real function ACLs.
  await db.exec("alter default privileges in schema public grant execute on functions to service_role")
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }
  // Supabase grants the service role full table access by default.
  await db.exec(`
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `)
  return db
}

export type Db = PGlite

/** Creates an auth user plus profile the way the invite/bootstrap flow does (service role). */
export async function createUser(
  db: Db,
  role: "super_admin" | "intern" | "client",
  name: string,
  status: "active" | "invited" | "disabled" = "active",
) {
  const id = randomUUID()
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`
  await asSystem(db)
  await db.query("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify({ role }),
  ])
  await db.query(
    "insert into public.profiles (id, email, full_name, role, status) values ($1, $2, $3, $4, $5)",
    [id, email, name, role, status],
  )
  return id
}

export async function asUser(db: Db, userId: string) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ])
  await db.exec("set role authenticated")
}

export async function asService(db: Db) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claims', '', false)")
  await db.exec("set role service_role")
}

export async function asSystem(db: Db) {
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claims', '', false)")
}
