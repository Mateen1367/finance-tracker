import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckCheck, Plus, Receipt, Search, X } from 'lucide-react'
import { api, useAccounts, useAction, useCategories, useSummary, useTransactions } from '../lib/api'
import { dayLabel, money, monthLabel, shiftMonth, currentMonth } from '../lib/format'
import { toast } from '../lib/toast'
import { Button, Card, Empty, PageHeader, Segmented, Skeleton } from '../components/ui'
import { AddTransactionSheet, groupByDay, TransactionRow, TransactionSheet } from '../components/transactions'

export default function Transactions() {
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') || 'all'
  const month = params.get('month') || ''
  const account = params.get('account') || ''
  const category = params.get('category') || ''
  const [search, setSearch] = useState(params.get('q') || '')
  const [query, setQuery] = useState(search)
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(t)
  }, [search])

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const { data: tx, isLoading } = useTransactions({
    month,
    account_id: account,
    category_id: filter === 'uncategorized' ? 'none' : category,
    q: query,
    review: filter === 'review',
  })
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: summary } = useSummary(currentMonth())
  const reviewAll = useAction(() => api.post('/transactions/review-all'), {
    onSuccess: (r) => toast.success(`Marked ${r.reviewed} transactions as reviewed`),
  })

  const list = tx || []
  const groups = useMemo(() => groupByDay(list), [list])
  const selectedIndex = list.findIndex((t) => t.id === selectedId)
  const selected = selectedIndex >= 0 ? list[selectedIndex] : null
  const [frozen, setFrozen] = useState(null) // keeps the sheet showing while the list refreshes
  const shown = selected || frozen

  const openTx = (t) => {
    setFrozen(t)
    setSelectedId(t.id)
  }
  const close = () => {
    setSelectedId(null)
    setFrozen(null)
  }
  // In review mode, jump straight to the next transaction that still needs a look.
  const next = filter === 'review' ? () => {
    const after = list[selectedIndex + 1] || list[selectedIndex - 1]
    if (after && after.id !== selectedId) openTx(after)
    else close()
  } : undefined

  const totalIn = list.filter((t) => t.amount > 0 && t.kind !== 'transfer').reduce((s, t) => s + t.amount, 0)
  const totalOut = -list.filter((t) => t.amount < 0 && t.kind !== 'transfer').reduce((s, t) => s + t.amount, 0)
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(), -i))

  return (
    <>
      <PageHeader title="Transactions" subtitle={`${list.length}${list.length >= 300 ? '+' : ''} shown · ${money(totalOut, { whole: true })} out · ${money(totalIn, { whole: true })} in`}>
        <div className="hidden md:block">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> Add
          </Button>
        </div>
      </PageHeader>

      <div className="relative mb-3">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
        <input className="input h-12 rounded-2xl bg-card pl-11" placeholder="Search merchants, descriptions, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && (
          <button className="absolute top-1/2 right-3 -translate-y-1/2 text-faint" onClick={() => setSearch('')} aria-label="Clear search">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="no-scrollbar -mx-4 mb-4 flex items-center gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented
          value={filter}
          onChange={(v) => setParam('filter', v === 'all' ? '' : v)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'review', label: `To review${summary?.to_review ? ` · ${summary.to_review}` : ''}` },
            { value: 'uncategorized', label: 'Uncategorized' },
          ]}
        />
        <select className="input h-9 w-auto shrink-0 rounded-full bg-card py-0 text-[13px]" value={month} onChange={(e) => setParam('month', e.target.value)}>
          <option value="">All dates</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <select className="input h-9 w-auto shrink-0 rounded-full bg-card py-0 text-[13px]" value={account} onChange={(e) => setParam('account', e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.mask ? ` ••${a.mask}` : ''}
            </option>
          ))}
        </select>
        {filter !== 'uncategorized' && (
          <select className="input h-9 w-auto shrink-0 rounded-full bg-card py-0 text-[13px]" value={category} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {filter === 'review' && list.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-accent-soft px-4 py-3">
          <p className="text-[13px] text-ink">Tap a transaction to check its category. You'll move straight on to the next one.</p>
          <Button size="sm" variant="secondary" loading={reviewAll.isPending} onClick={() => reviewAll.mutate()}>
            <CheckCheck size={15} /> All good
          </Button>
        </div>
      )}

      {isLoading && !tx ? (
        <Skeleton className="h-96" />
      ) : list.length === 0 ? (
        <Card>
          <Empty
            icon={filter === 'review' ? CheckCheck : Receipt}
            title={filter === 'review' ? "You're all caught up" : 'No transactions found'}
            text={filter === 'review' ? 'Every transaction has been reviewed.' : 'Try a different search or filter, or add one yourself.'}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {groups.map((g) => {
            const dayTotal = g.items.filter((t) => t.kind !== 'transfer').reduce((s, t) => s + t.amount, 0)
            return (
              <section key={g.date}>
                <div className="sticky top-0 z-10 flex justify-between border-b border-line bg-card-2/95 px-4 py-2 text-xs font-semibold text-muted backdrop-blur md:px-5">
                  <span>{dayLabel(g.date)}</span>
                  <span className="tabular">{money(dayTotal, { signed: true })}</span>
                </div>
                <div className="divide-y divide-line">
                  {g.items.map((t) => (
                    <TransactionRow key={t.id} tx={t} onClick={() => openTx(t)} />
                  ))}
                </div>
              </section>
            )
          })}
        </Card>
      )}

      <button
        onClick={() => setAdding(true)}
        aria-label="Add transaction"
        className="fixed right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition active:scale-95 md:hidden"
      >
        <Plus size={26} />
      </button>

      {shown && <TransactionSheet key={shown.id} tx={shown} onClose={close} onNext={next} />}
      <AddTransactionSheet open={adding} onClose={() => setAdding(false)} />
    </>
  )
}
