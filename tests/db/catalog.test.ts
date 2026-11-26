import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { DB_URL, sql } from '../helpers/db'

/**
 * Guard rails over the whole public schema. These must keep passing as tables
 * and functions are added: a migration that opens something up by accident
 * fails here. Every exception is listed explicitly below, so loosening the
 * rules means editing this file on purpose.
 */

const CLIENT_ROLES = ['anon', 'authenticated'] as const

/** Table-level privileges client roles may hold. Everything else must be absent. */
const ALLOWED_TABLE_PRIVILEGES = new Set([
  'anon:paint_colors:SELECT',
  'authenticated:paint_colors:SELECT',
  'authenticated:profiles:SELECT',
])

/** Column-level privileges client roles may hold (on top of the table-level ones). */
const ALLOWED_COLUMN_WRITES = new Set(['authenticated:profiles.display_name:UPDATE'])

/** Functions in public that client roles may execute. Deliberately empty. */
const ALLOWED_CLIENT_FUNCTIONS = new Set<string>()

describe('public schema guard rails', () => {
  it('has row level security on every table', async () => {
    const rows = await sql<{ relname: string }>(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('grants client roles only the allowed table privileges', async () => {
    const rows = await sql<{ grantee: string; table_name: string; privilege_type: string }>(`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')`)
    const actual = rows.map((r) => `${r.grantee}:${r.table_name}:${r.privilege_type}`)
    expect(actual.filter((p) => !ALLOWED_TABLE_PRIVILEGES.has(p))).toEqual([])
  })

  it('grants client roles no column-level write except the allowed ones', async () => {
    const rows = await sql<{
      grantee: string
      table_name: string
      column_name: string
      privilege_type: string
    }>(`
      select grantee, table_name, column_name, privilege_type
      from information_schema.column_privileges
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
        and privilege_type <> 'SELECT'`)
    const actual = rows.map(
      (r) => `${r.grantee}:${r.table_name}.${r.column_name}:${r.privilege_type}`,
    )
    expect(actual.filter((p) => !ALLOWED_COLUMN_WRITES.has(p))).toEqual([])
  })

  it('lets no client role execute any function in public', async () => {
    const rows = await sql<{ fn: string; role: string }>(`
      select p.oid::regprocedure::text as fn, r.role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join (values ('anon'), ('authenticated')) as r(role)
      where n.nspname = 'public'
        and has_function_privilege(r.role, p.oid, 'EXECUTE')`)
    const actual = rows.map((r) => `${r.role}:${r.fn}`)
    expect(actual.filter((f) => !ALLOWED_CLIENT_FUNCTIONS.has(f))).toEqual([])
  })

  it('pins search_path on every SECURITY DEFINER function', async () => {
    const rows = await sql<{ fn: string }>(`
      select p.oid::regprocedure::text as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
        )`)
    expect(rows.map((r) => r.fn)).toEqual([])
  })

  it('names the roles of every policy explicitly', async () => {
    const rows = await sql<{ tablename: string; policyname: string }>(`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and 'public' = any(roles)`)
    expect(rows).toEqual([])
  })

  it('keeps default privileges closed for new tables and functions', async () => {
    // Create objects the way a migration would, inspect them, then roll back.
    const client = new pg.Client({ connectionString: DB_URL })
    await client.connect()
    try {
      await client.query('begin')
      await client.query('create table public.zz_guard_probe (id int)')
      await client.query(
        'create function public.zz_guard_probe_fn() returns int language sql as $$ select 1 $$',
      )

      for (const role of CLIENT_ROLES) {
        const { rows } = await client.query<{ any: boolean }>(
          `select has_table_privilege($1, 'public.zz_guard_probe', 'select,insert,update,delete') as any`,
          [role],
        )
        expect(rows[0].any, `${role} on a new table`).toBe(false)
      }

      // Postgres grants EXECUTE on every new function to PUBLIC, which anon and
      // authenticated inherit, and default privileges cannot remove a PUBLIC
      // grant per schema. So each migration revokes it per function (the test
      // above proves that). What this checks is that the default ACLs add no
      // direct grant to the client roles on top.
      const { rows: acl } = await client.query<{ acl: string | null }>(`
        select array_to_string(p.proacl, ',') as acl
        from pg_proc p where p.oid = 'public.zz_guard_probe_fn()'::regprocedure`)
      const directGrants = (acl[0].acl ?? '')
        .split(',')
        .filter((entry) => /^(anon|authenticated)=/.test(entry))
      expect(directGrants).toEqual([])
    } finally {
      await client.query('rollback')
      await client.end()
    }
  })
})
