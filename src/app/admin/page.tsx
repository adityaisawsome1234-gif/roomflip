import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { isAdmin } from '@/lib/auth/admin'
import { getSessionUser } from '@/lib/auth/session'
import { cn } from '@/lib/cn'
import { isModelId, MODELS } from '@/lib/config/models'
import { formatUsd } from '@/lib/config/pricing'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Admin', robots: { index: false } }

const PERIODS = [7, 30, 90] as const

/** Admin: users, renders, cost per render and revenue. Only for ADMIN_EMAILS. */
export default function AdminPage({ searchParams }: PageProps<'/admin'>) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Admin searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

/** ISO timestamp `days` before now. Runs per request: this page is never cached. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function usd(value: number | string | null | undefined, digits = 2): string {
  const n = Number(value ?? 0)
  return n !== 0 && Math.abs(n) < 0.1 ? `$${n.toFixed(4)}` : formatUsd(Number(n.toFixed(digits)))
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-card border-line bg-surface flex flex-col gap-1 border p-4">
      <span className="text-muted text-sm">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-muted text-xs">{note}</span>}
    </div>
  )
}

function Table({
  caption,
  head,
  children,
}: {
  caption: string
  head: string[]
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{caption}</h2>
      <div className="rounded-card border-line bg-surface overflow-x-auto border">
        <table className="w-full text-left text-sm">
          <thead className="border-line text-muted border-b">
            <tr>
              {head.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn('px-3 py-2 font-medium whitespace-nowrap', i > 0 && 'text-right')}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y tabular-nums">{children}</tbody>
        </table>
      </div>
    </section>
  )
}

function Cell({ children, left }: { children: ReactNode; left?: boolean }) {
  return <td className={cn('px-3 py-2 whitespace-nowrap', !left && 'text-right')}>{children}</td>
}

async function Admin({ searchParams }: Pick<PageProps<'/admin'>, 'searchParams'>) {
  const user = await getSessionUser()
  if (!isAdmin(user)) notFound()

  const params = await searchParams
  const days = PERIODS.find((d) => String(d) === params.days) ?? 30
  const search = typeof params.q === 'string' ? params.q.slice(0, 100) : ''
  const since = daysAgo(days)

  const db = createAdminClient()
  const [overview, models, revenue, users, recent] = await Promise.all([
    db.rpc('admin_overview', { p_since: since }),
    db.rpc('admin_model_costs', { p_since: since }),
    db.rpc('admin_revenue', { p_since: since }),
    db.rpc('admin_users', { p_search: search, p_limit: 50 }),
    db.rpc('admin_recent_renders', { p_limit: 50 }),
  ])
  const o = (overview.data ?? {}) as Record<string, number>
  const revenueUsd = Number(o.revenue_cents ?? 0) / 100
  const spend = Number(o.model_spend_usd ?? 0)
  const finished = Number(o.renders_succeeded ?? 0) + Number(o.renders_failed ?? 0)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted text-sm font-medium">Admin</p>
          <h1 className="font-display text-4xl tracking-tight">Last {days} days</h1>
        </div>
        <nav aria-label="Period" className="flex gap-2">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={`/admin?days=${d}`}
              aria-current={d === days ? 'page' : undefined}
              className={cn(
                'min-h-10 rounded-full border px-4 py-2 text-sm font-medium',
                d === days ? 'border-ink bg-ink text-bg' : 'border-line bg-surface',
              )}
            >
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Revenue"
          value={usd(revenueUsd)}
          note={`${usd(Number(o.revenue_cents_all_time ?? 0) / 100)} all time`}
        />
        <Tile
          label="Model spend"
          value={usd(spend)}
          note={finished ? `${usd(spend / Math.max(1, Number(o.renders)))} per render` : undefined}
        />
        <Tile
          label="Gross margin"
          value={usd(revenueUsd - spend)}
          note={
            revenueUsd ? `${Math.round(((revenueUsd - spend) / revenueUsd) * 100)}%` : undefined
          }
        />
        <Tile
          label="Renders"
          value={String(o.renders ?? 0)}
          note={`${o.renders_succeeded ?? 0} done · ${o.renders_failed ?? 0} failed`}
        />
        <Tile
          label="New users"
          value={String(o.users_new ?? 0)}
          note={`${o.users_total ?? 0} in total`}
        />
        <Tile label="Paying users" value={String(o.paying_users ?? 0)} note="All time" />
        <Tile label="Active plans" value={String(o.active_subscriptions ?? 0)} />
        <Tile label="Exports" value={String(o.exports ?? 0)} />
      </section>

      <Table
        caption="Cost per render, by model"
        head={[
          'Model',
          'Tier',
          'Renders',
          'Done',
          'Failed',
          'Submissions',
          'Price set',
          'Avg cost',
          'Spend',
          'Avg time',
        ]}
      >
        {(models.data ?? []).map((row) => (
          <tr key={`${row.model}-${row.tier}`}>
            <Cell left>{isModelId(row.model) ? MODELS[row.model].label : row.model}</Cell>
            <Cell>{row.tier}</Cell>
            <Cell>{row.renders}</Cell>
            <Cell>{row.succeeded}</Cell>
            <Cell>{row.failed}</Cell>
            <Cell>{row.submissions}</Cell>
            <Cell>{isModelId(row.model) ? usd(MODELS[row.model].costUsd) : '–'}</Cell>
            <Cell>{usd(row.avg_cost_usd)}</Cell>
            <Cell>{usd(row.spend_usd)}</Cell>
            <Cell>{row.avg_seconds ? `${row.avg_seconds}s` : '–'}</Cell>
          </tr>
        ))}
      </Table>

      <Table caption="Revenue, by product" head={['Product', 'Type', 'Payments', 'Revenue']}>
        {(revenue.data ?? []).map((row) => (
          <tr key={row.item_id}>
            <Cell left>{row.item_id}</Cell>
            <Cell>{row.kind}</Cell>
            <Cell>{row.payments}</Cell>
            <Cell>{usd(Number(row.amount_cents) / 100)}</Cell>
          </tr>
        ))}
      </Table>

      <section className="flex flex-col gap-3">
        <form className="flex gap-2" action="/admin">
          <input type="hidden" name="days" value={days} />
          <label className="sr-only" htmlFor="admin-search">
            Search users by email
          </label>
          <input
            id="admin-search"
            name="q"
            defaultValue={search}
            placeholder="Search by email"
            className="rounded-control border-line bg-surface min-h-11 flex-1 border px-3 text-base"
          />
          <button className="bg-ink text-bg min-h-11 rounded-full px-5 text-sm font-semibold">
            Search
          </button>
        </form>
        <Table caption="Users" head={['Email', 'Joined', 'Renders', 'Credits', 'Plan', 'Paid']}>
          {(users.data ?? []).map((row) => (
            <tr key={row.id}>
              <Cell left>{row.email}</Cell>
              <Cell>
                {new Date(row.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Cell>
              <Cell>{row.renders}</Cell>
              <Cell>{row.balance}</Cell>
              <Cell>{row.plan ?? '–'}</Cell>
              <Cell>{usd(Number(row.revenue_cents) / 100)}</Cell>
            </tr>
          ))}
        </Table>
      </section>

      <Table
        caption="Recent renders"
        head={['When', 'User', 'Mode', 'Tier', 'Model', 'Status', 'Tries', 'Cost', 'Time']}
      >
        {(recent.data ?? []).map((row) => (
          <tr key={row.id}>
            <Cell left>
              {new Date(row.created_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Cell>
            <Cell>{row.email}</Cell>
            <Cell>{row.mode}</Cell>
            <Cell>{row.tier}</Cell>
            <Cell>{isModelId(row.model) ? MODELS[row.model].label : row.model}</Cell>
            <Cell>{row.status === 'failed' ? `failed: ${row.error_code}` : row.status}</Cell>
            <Cell>{row.attempts}</Cell>
            <Cell>{usd(row.cost_usd)}</Cell>
            <Cell>{row.seconds ? `${row.seconds}s` : '–'}</Cell>
          </tr>
        ))}
      </Table>
    </>
  )
}
