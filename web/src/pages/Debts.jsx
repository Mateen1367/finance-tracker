import { useEffect, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarClock, Flag, Plus, RefreshCw, Trash2, TrendingDown } from 'lucide-react'
import { api, useAction, useDebts, usePlan } from '../lib/api'
import { compactMoney, money, monthLabel, relativeDays, shortDate } from '../lib/format'
import { toast } from '../lib/toast'
import { Badge, Button, Card, CardHeader, Empty, Field, PageHeader, Segmented, Sheet, Skeleton } from '../components/ui'

export default function Debts() {
  const { data: debts } = useDebts()
  const [editing, setEditing] = useState(null)
  if (!debts) return <Skeleton className="h-96" />

  const active = debts.filter((d) => d.balance > 0)
  const total = active.reduce((s, d) => s + d.balance, 0)
  const minimums = active.reduce((s, d) => s + d.min_payment, 0)
  const avgApr = total ? active.reduce((s, d) => s + d.balance * d.apr, 0) / total : 0
  const newDebt = { name: '', lender: '', balance: '', apr: '', min_payment: '', due_day: '', notes: '' }

  return (
    <>
      <PageHeader title="Debts" subtitle="Everything you owe, and your fastest way out">
        <Button onClick={() => setEditing(newDebt)}>
          <Plus size={16} /> Add debt
        </Button>
      </PageHeader>

      {debts.length === 0 ? (
        <Card>
          <Empty icon={TrendingDown} title="No debts tracked" text="Add loans, credit cards or money you owe people. Connected credit cards and loans appear here automatically.">
            <Button onClick={() => setEditing(newDebt)}>
              <Plus size={16} /> Add a debt
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="mb-4 grid grid-cols-3 divide-x divide-line p-5 text-center">
            <div>
              <div className="text-[13px] text-muted">Total owed</div>
              <div className="tabular text-xl font-semibold tracking-tight">{money(total, { whole: true })}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Minimums / mo</div>
              <div className="tabular text-xl font-semibold tracking-tight">{money(minimums, { whole: true })}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Avg. interest</div>
              <div className="tabular text-xl font-semibold tracking-tight">{avgApr.toFixed(1)}%</div>
            </div>
          </Card>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {debts.map((d) => (
              <button key={d.id} onClick={() => setEditing(d)} className="text-left">
                <Card className="h-full p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{d.name}</div>
                      <div className="truncate text-[13px] text-muted">{d.lender || 'No lender set'}</div>
                    </div>
                    <div className="flex gap-1">
                      {d.synced && (
                        <Badge tone="accent">
                          <RefreshCw size={10} /> Synced
                        </Badge>
                      )}
                      <Badge tone={d.apr >= 15 ? 'bad' : d.apr >= 7 ? 'warn' : 'muted'}>{d.apr}% APR</Badge>
                    </div>
                  </div>
                  <div className="tabular mt-3 text-2xl font-semibold tracking-tight">{money(d.balance)}</div>
                  <div className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
                    <CalendarClock size={14} />
                    {money(d.min_payment)} minimum
                    {d.next_due && (
                      <>
                        {' '}
                        · due {shortDate(d.next_due)} <span className={relativeDays(d.next_due).match(/today|tomorrow|in [1-3] days/) ? 'font-medium text-warn' : ''}>({relativeDays(d.next_due)})</span>
                      </>
                    )}
                  </div>
                </Card>
              </button>
            ))}
          </div>

          {active.length > 0 && <PayoffPlanner minimums={minimums} />}
        </>
      )}

      {editing && <DebtSheet debt={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function PayoffPlanner({ minimums }) {
  const [extra, setExtra] = useState(200)
  const [debounced, setDebounced] = useState(extra)
  const [strategy, setStrategy] = useState('avalanche')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(extra), 200)
    return () => clearTimeout(t)
  }, [extra])
  const { data: plan } = usePlan(debounced)
  if (!plan) return <Skeleton className="h-80" />

  const chosen = plan[strategy]
  const baseline = plan.minimum
  const saved = baseline.months && chosen.months ? baseline.total_interest - chosen.total_interest : null
  const monthsSooner = baseline.months && chosen.months ? baseline.months - chosen.months : null
  const length = Math.max(chosen.history.length, baseline.history.length)
  const data = Array.from({ length }, (_, i) => ({
    month: i,
    plan: chosen.history[i]?.balance ?? (i < chosen.history.length ? null : 0),
    minimum: baseline.history[i]?.balance ?? null,
  }))

  return (
    <Card>
      <CardHeader title="Payoff planner" />
      <div className="px-5 pb-5">
        <Field label={`Extra each month on top of ${money(minimums, { whole: true })} in minimums`}>
          <div className="flex items-center gap-4">
            <input type="range" min={0} max={2000} step={25} value={extra} onChange={(e) => setExtra(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            <input className="input tabular w-28 text-right font-semibold" inputMode="decimal" value={extra} onChange={(e) => setExtra(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </Field>
        <Segmented
          className="mt-4 w-full"
          value={strategy}
          onChange={setStrategy}
          options={[
            { value: 'avalanche', label: 'Avalanche · highest interest first' },
            { value: 'snowball', label: 'Snowball · smallest first' },
          ]}
        />

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-accent-soft p-4">
            <div className="text-[13px] text-muted">Debt-free by</div>
            <div className="text-xl font-semibold tracking-tight text-accent">{chosen.debt_free ? monthLabel(chosen.debt_free.slice(0, 7), { short: true }) : 'Never'}</div>
            <div className="text-xs text-muted">{chosen.months ? `${chosen.months} months` : "Payments don't cover interest"}</div>
          </div>
          <div className="rounded-2xl bg-card-2 p-4">
            <div className="text-[13px] text-muted">Total interest</div>
            <div className="tabular text-xl font-semibold tracking-tight">{money(chosen.total_interest, { whole: true })}</div>
            <div className="text-xs text-muted">vs {money(baseline.total_interest, { whole: true })} paying minimums</div>
          </div>
          {saved != null && (
            <div className="col-span-2 rounded-2xl bg-good/10 p-4 sm:col-span-1">
              <div className="text-[13px] text-muted">You save</div>
              <div className="tabular text-xl font-semibold tracking-tight text-good">{money(saved, { whole: true })}</div>
              <div className="text-xs text-muted">and finish {monthsSooner} months sooner</div>
            </div>
          )}
        </div>

        <div className="mt-5 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="debtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} tickFormatter={(m) => (m % 12 === 0 ? `${m / 12}y` : '')} interval={0} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} tickFormatter={compactMoney} width={48} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
                      <div className="mb-1 font-medium text-muted">Month {label}</div>
                      {payload.map((p) => (
                        <div key={p.dataKey} className="tabular">
                          {p.dataKey === 'plan' ? 'Your plan' : 'Minimums only'}: {money(p.value, { whole: true })}
                        </div>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="minimum" stroke="var(--faint)" strokeDasharray="4 4" strokeWidth={1.5} fill="none" dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="plan" stroke="var(--accent)" strokeWidth={2.5} fill="url(#debtFill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {chosen.order.length > 0 && (
          <ol className="mt-5 space-y-0">
            {chosen.order.map((o, i) => (
              <li key={o.name + i} className="relative flex items-center gap-3 pb-4 last:pb-0">
                {i < chosen.order.length - 1 && <span className="absolute top-8 left-[15px] h-[calc(100%-24px)] w-0.5 bg-line" />}
                <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  {i === chosen.order.length - 1 ? <Flag size={14} /> : <span className="text-xs font-semibold">{i + 1}</span>}
                </span>
                <span className="flex-1 text-sm font-medium">{o.name} paid off</span>
                <span className="text-sm text-muted">{monthLabel(o.date.slice(0, 7), { short: true })}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  )
}

function DebtSheet({ debt, onClose }) {
  const isNew = !debt.id
  const [form, setForm] = useState({ ...debt, due_day: debt.due_day ?? '' })
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const save = useAction(
    (body) => (isNew ? api.post('/debts', body) : api.patch(`/debts/${debt.id}`, body)),
    {
      onSuccess: () => {
        toast.success(isNew ? 'Debt added' : 'Debt saved')
        onClose()
      },
    },
  )
  const remove = useAction(() => api.del(`/debts/${debt.id}`), { onSuccess: onClose })
  const submit = (e) => {
    e.preventDefault()
    if (!form.name.trim() || form.balance === '') return toast.error('A name and balance are required')
    save.mutate({
      name: form.name,
      lender: form.lender || '',
      balance: Math.abs(Number(form.balance) || 0),
      apr: Number(form.apr) || 0,
      min_payment: Number(form.min_payment) || 0,
      due_day: form.due_day === '' ? null : Math.min(31, Math.max(1, Number(form.due_day))),
      notes: form.notes || '',
    })
  }
  return (
    <Sheet open onClose={onClose} title={isNew ? 'Add a debt' : debt.name}>
      <form className="space-y-3" onSubmit={submit}>
        {debt.synced && <p className="rounded-2xl bg-accent-soft px-4 py-3 text-[13px]">This debt syncs from your bank, so its balance and rate update automatically.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2 sm:col-span-1">
            <input className="input" placeholder="e.g. Car loan" value={form.name} onChange={set('name')} autoFocus={isNew} />
          </Field>
          <Field label="Lender or person" className="col-span-2 sm:col-span-1">
            <input className="input" placeholder="e.g. Chase, or Mom" value={form.lender} onChange={set('lender')} />
          </Field>
          <Field label="Balance owed">
            <input className="input tabular" inputMode="decimal" value={form.balance} onChange={set('balance')} />
          </Field>
          <Field label="Interest rate (APR %)">
            <input className="input tabular" inputMode="decimal" placeholder="0" value={form.apr} onChange={set('apr')} />
          </Field>
          <Field label="Minimum payment / month">
            <input className="input tabular" inputMode="decimal" placeholder="0" value={form.min_payment} onChange={set('min_payment')} />
          </Field>
          <Field label="Due day of month">
            <input className="input tabular" inputMode="numeric" placeholder="e.g. 15" value={form.due_day} onChange={set('due_day')} />
          </Field>
        </div>
        <Field label="Notes">
          <input className="input" value={form.notes} onChange={set('notes')} placeholder="Optional" />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="submit" size="lg" className="flex-1" loading={save.isPending}>
            {isNew ? 'Add debt' : 'Save changes'}
          </Button>
          {!isNew && (
            <Button type="button" size="lg" variant="danger" onClick={() => confirm(`Remove ${debt.name}?`) && remove.mutate()} aria-label="Delete debt">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  )
}
