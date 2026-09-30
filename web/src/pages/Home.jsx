import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Inbox, Landmark, Link2, PencilLine, Sparkles } from 'lucide-react'
import { api, useAction, useSettings, useSummary } from '../lib/api'
import { currentMonth, greeting, money, monthLabel, relativeDays, shortDate } from '../lib/format'
import { toast } from '../lib/toast'
import { Card, CardHeader, MerchantIcon, MonthSwitcher, PageHeader, Progress, Ring, Skeleton } from '../components/ui'
import { TransactionRow, TransactionSheet } from '../components/transactions'
import { Logo } from '../components/Layout'

export default function Home() {
  const [month, setMonth] = useState(currentMonth())
  const { data: s } = useSummary(month)
  const { data: settings } = useSettings()
  const [selected, setSelected] = useState(null)

  if (!s) return <HomeSkeleton />
  if (!s.has_accounts) return <Welcome settings={settings} />

  const isCurrent = month === currentMonth()
  const monthName = monthLabel(month).split(' ')[0]

  return (
    <>
      <PageHeader title={greeting(settings?.name)} subtitle={isCurrent ? "Here's where your money stands" : monthLabel(month)}>
        <MonthSwitcher month={month} onChange={setMonth} />
      </PageHeader>

      {s.to_review > 0 && (
        <Link
          to="/transactions?filter=review"
          className="mb-4 flex items-center gap-3 rounded-3xl bg-accent px-5 py-4 text-white shadow-sm transition hover:brightness-110"
        >
          <div className="grid size-10 place-items-center rounded-2xl bg-white/15">
            <Inbox size={20} />
          </div>
          <div className="flex-1">
            <div className="font-semibold">
              {s.to_review} new transaction{s.to_review === 1 ? '' : 's'} to review
            </div>
            <div className="text-[13px] text-white/75">Check categories so your budgets stay accurate</div>
          </div>
          <ArrowRight size={20} />
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SpendingCard s={s} isCurrent={isCurrent} monthName={monthName} />
        <div className="grid gap-4">
          <BudgetCard s={s} />
          <NetWorthCard s={s} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <TopCategories s={s} />
        <Upcoming items={s.upcoming} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Recent transactions"
          action={
            <Link to="/transactions" className="text-[13px] font-medium text-accent">
              See all
            </Link>
          }
        />
        <div className="divide-y divide-line pb-1">
          {s.recent.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} compact onClick={() => setSelected(tx)} />
          ))}
        </div>
      </Card>
      {selected && <TransactionSheet key={selected.id} tx={selected} onClose={() => setSelected(null)} />}
    </>
  )
}

function SpendingCard({ s, isCurrent, monthName }) {
  const { this_month: thisMonth, last_month: lastMonth } = s.daily
  const data = Array.from({ length: Math.max(thisMonth.length, lastMonth.length) }, (_, i) => ({
    day: i + 1,
    this: thisMonth[i] ?? null,
    last: lastMonth[i] ?? null,
  }))
  const compareDay = Math.min(thisMonth.length, lastMonth.length) - 1
  const lastAtSameDay = isCurrent ? lastMonth[compareDay] ?? 0 : lastMonth[lastMonth.length - 1] ?? 0
  const diff = s.spending - lastAtSameDay

  return (
    <Card className="p-5 md:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-muted">Spent in {monthName}</div>
          <div className="tabular mt-1 text-[40px] leading-none font-semibold tracking-tight">{money(s.spending, { whole: s.spending >= 10000 })}</div>
          <div className="mt-2 text-[13px] text-muted">
            {lastAtSameDay > 0 ? (
              <>
                <span className={diff > 0 ? 'font-medium text-bad' : 'font-medium text-good'}>
                  {money(Math.abs(diff), { whole: true })} {diff > 0 ? 'more' : 'less'}
                </span>{' '}
                than last month{isCurrent ? ' by this day' : ''}
              </>
            ) : (
              'No spending last month to compare'
            )}
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <div className="text-[13px] text-muted">Income</div>
          <div className="tabular font-semibold text-good">{money(s.income, { whole: true })}</div>
        </div>
      </div>
      <div className="mt-4 -mx-1 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" ticks={[1, 8, 15, 22, 29]} tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} />
            <YAxis hide domain={[0, 'dataMax']} />
            <Tooltip content={<PaceTooltip />} cursor={{ stroke: 'var(--line)', strokeWidth: 1 }} />
            <Area type="monotone" dataKey="last" stroke="var(--faint)" strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="this" stroke="var(--accent)" strokeWidth={2.5} fill="url(#spendFill)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-accent" /> This month
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-[1.5px] border-dashed border-faint" /> Last month
        </span>
      </div>
    </Card>
  )
}

function PaceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const value = (key) => payload.find((p) => p.dataKey === key)?.value
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-muted">Day {label}</div>
      {value('this') != null && <div className="tabular font-semibold">This month: {money(value('this'), { whole: true })}</div>}
      {value('last') != null && <div className="tabular text-muted">Last month: {money(value('last'), { whole: true })}</div>}
    </div>
  )
}

function BudgetCard({ s }) {
  const budgeted = s.by_category.filter((c) => c.budget > 0)
  const spent = budgeted.reduce((sum, c) => sum + c.spent, 0)
  const left = s.budget_total - spent
  return (
    <Link to="/budgets">
      <Card className="flex items-center gap-4 p-5 transition hover:bg-card-2">
        {s.budget_total > 0 ? (
          <>
            <Ring value={spent} max={s.budget_total} size={76} stroke={9}>
              <span className="text-[13px] font-semibold">{Math.round((spent / s.budget_total) * 100)}%</span>
            </Ring>
            <div>
              <div className="text-[13px] text-muted">{left >= 0 ? 'Left to spend' : 'Over budget'}</div>
              <div className={`tabular text-xl font-semibold tracking-tight ${left < 0 ? 'text-bad' : ''}`}>{money(Math.abs(left), { whole: true })}</div>
              <div className="text-xs text-muted">of {money(s.budget_total, { whole: true })} budgeted</div>
            </div>
          </>
        ) : (
          <div>
            <div className="font-semibold">Set up budgets</div>
            <div className="text-[13px] text-muted">Pick monthly limits for the categories you care about</div>
          </div>
        )}
      </Card>
    </Link>
  )
}

function NetWorthCard({ s }) {
  return (
    <Link to="/accounts">
      <Card className="p-5 transition hover:bg-card-2">
        <div className="text-[13px] text-muted">Net worth</div>
        <div className={`tabular text-xl font-semibold tracking-tight ${s.net_worth < 0 ? 'text-bad' : ''}`}>{money(s.net_worth, { whole: true })}</div>
        <div className="mt-2 flex gap-4 text-xs">
          <span className="text-muted">
            Assets <span className="tabular font-medium text-ink">{money(s.assets, { whole: true })}</span>
          </span>
          <span className="text-muted">
            Debts <span className="tabular font-medium text-ink">{money(s.liabilities, { whole: true })}</span>
          </span>
        </div>
      </Card>
    </Link>
  )
}

function TopCategories({ s }) {
  const top = s.by_category.filter((c) => c.spent > 0).slice(0, 6)
  const max = top[0]?.spent || 1
  return (
    <Card>
      <CardHeader
        title="Top categories"
        action={
          <Link to="/budgets" className="text-[13px] font-medium text-accent">
            Budgets
          </Link>
        }
      />
      <div className="space-y-3.5 px-5 pt-1 pb-5">
        {top.length === 0 && <p className="py-6 text-center text-sm text-muted">No spending yet this month.</p>}
        {top.map((c) => (
          <Link key={c.id ?? 'none'} to={`/transactions?category=${c.id ?? 'none'}&month=${s.month}`} className="flex items-center gap-3">
            <MerchantIcon emoji={c.emoji} color={c.color} size={34} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-sm">
                <span className="truncate font-medium">{c.name}</span>
                <span className="tabular font-medium">{money(c.spent, { whole: true })}</span>
              </div>
              <Progress className="mt-1.5 h-1.5" value={c.spent} max={c.budget > 0 ? c.budget : max} color={c.budget > 0 ? undefined : c.color} />
            </div>
          </Link>
        ))}
      </div>
    </Card>
  )
}

function Upcoming({ items }) {
  return (
    <Card>
      <CardHeader
        title="Coming up"
        action={
          <Link to="/recurring" className="text-[13px] font-medium text-accent">
            All recurring
          </Link>
        }
      />
      <div className="px-2 pb-3">
        {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">No bills or subscriptions expected in the next two weeks.</p>}
        {items.map((r) => (
          <div key={r.merchant} className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <MerchantIcon name={r.merchant} logo={r.logo_url} emoji={r.category_emoji} color={r.category_color} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{r.merchant}</div>
              <div className="text-xs text-muted">
                {shortDate(r.next_expected)} · {relativeDays(r.next_expected)}
              </div>
            </div>
            <span className="tabular text-sm font-semibold">{money(r.avg_amount)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Welcome({ settings }) {
  const navigate = useNavigate()
  const loadDemo = useAction(() => api.post('/demo'), { onSuccess: () => toast.success('Demo data loaded. Have a look around!') })
  const options = [
    {
      icon: Link2,
      title: 'Connect your bank',
      text: settings?.plaid?.configured ? 'Securely link accounts with Plaid. Transactions sync automatically.' : 'Set up Plaid once, then link your accounts securely.',
      onClick: () => navigate(settings?.plaid?.configured ? '/accounts?connect=1' : '/accounts?setup=1'),
      primary: true,
    },
    { icon: PencilLine, title: 'Add an account manually', text: 'Track cash or import CSV statements from your bank.', onClick: () => navigate('/accounts?add=1') },
    { icon: Sparkles, title: 'Explore with demo data', text: 'Fill the app with six months of sample data. You can remove it later.', onClick: () => loadDemo.mutate() },
  ]
  return (
    <div className="mx-auto max-w-xl pt-6 md:pt-14">
      <Logo size={56} />
      <h1 className="mt-5 text-[34px] leading-tight font-semibold tracking-tight">Your money, all in one place.</h1>
      <p className="mt-2 text-[15px] text-muted">Track spending, stay on budget, catch every subscription and plan your way out of debt. Everything stays private on this computer.</p>
      <div className="mt-8 space-y-3">
        {options.map(({ icon: Icon, title, text, onClick, primary }) => (
          <button
            key={title}
            onClick={onClick}
            className={`flex w-full items-center gap-4 rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
              primary ? 'border-accent bg-accent-soft' : 'border-line bg-card'
            }`}
          >
            <div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${primary ? 'bg-accent text-white' : 'bg-card-2 text-accent'}`}>
              <Icon size={20} />
            </div>
            <div className="flex-1">
              <div className="font-semibold">{title}</div>
              <div className="text-[13px] text-muted">{text}</div>
            </div>
            <ArrowRight size={18} className="text-faint" />
          </button>
        ))}
      </div>
      {loadDemo.isPending && <p className="mt-4 text-center text-sm text-muted">Loading demo data…</p>}
      <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-faint">
        <Landmark size={13} /> Bank connections are read-only. This app can't move money.
      </p>
    </div>
  )
}

function HomeSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-72 md:col-span-2" />
        <div className="grid gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

