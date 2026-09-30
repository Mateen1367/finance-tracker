import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, Trash2 } from 'lucide-react'
import { api, useAccounts, useAction, useCategories } from '../lib/api'
import { dayLabel, isoDate, money } from '../lib/format'
import { toast } from '../lib/toast'
import { Amount, Badge, Button, Field, MerchantIcon, Segmented, Sheet, Toggle } from './ui'

export function TransactionRow({ tx, onClick, compact }) {
  const name = tx.merchant || tx.description
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-card-2 md:px-5">
      <MerchantIcon name={name} logo={tx.logo_url} emoji={tx.category_emoji} color={tx.category_color} size={compact ? 36 : 40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-medium">{name}</span>
          {!tx.reviewed && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Needs review" />}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[13px] text-muted">
          {tx.category ? (
            <span className="shrink-0">{tx.category}</span>
          ) : (
            <span className="shrink-0 font-medium text-warn">Uncategorized</span>
          )}
          <span className="text-faint">·</span>
          <span className="truncate">
            {compact ? dayLabel(tx.date) : tx.account}
            {!compact && tx.account_mask ? ` ••${tx.account_mask}` : ''}
          </span>
          {!!tx.pending && <Badge>Pending</Badge>}
        </div>
      </div>
      <Amount value={tx.amount} className="text-[15px]" />
    </button>
  )
}

export function groupByDay(transactions) {
  const groups = []
  for (const tx of transactions) {
    const last = groups[groups.length - 1]
    if (last && last.date === tx.date) last.items.push(tx)
    else groups.push({ date: tx.date, items: [tx] })
  }
  return groups
}

export function CategoryPicker({ value, onPick }) {
  const { data: categories = [] } = useCategories()
  const sections = [
    ['Spending', categories.filter((c) => c.kind === 'expense')],
    ['Income', categories.filter((c) => c.kind === 'income')],
    ['Moving money', categories.filter((c) => c.kind === 'transfer')],
  ]
  return (
    <div className="space-y-3">
      {sections.map(([title, items]) =>
        items.length ? (
          <div key={title}>
            <div className="mb-1.5 text-xs font-medium tracking-wide text-faint uppercase">{title}</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onPick(c.id)}
                  className={clsx(
                    'flex flex-col items-center gap-1 rounded-2xl border px-1 py-2.5 text-center transition',
                    value === c.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-card-2',
                  )}
                >
                  <span className="text-xl leading-none">{c.emoji}</span>
                  <span className="line-clamp-1 text-[11.5px] font-medium">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  )
}

export function TransactionSheet({ tx, onClose, onNext }) {
  const name = tx.merchant || tx.description
  const [remember, setRemember] = useState(false)
  const [notes, setNotes] = useState(tx.notes || '')
  const update = useAction((body) => api.patch(`/transactions/${tx.id}`, body))
  const remove = useAction(() => api.del(`/transactions/${tx.id}`), {
    onSuccess: () => {
      toast.success('Transaction deleted')
      onClose()
    },
  })

  const pick = (categoryId) =>
    update.mutate(
      { category_id: categoryId, apply_to_merchant: remember, ...(notes !== (tx.notes || '') ? { notes } : {}) },
      {
        onSuccess: (r) => {
          toast.success(r.also_updated ? `Also recategorized ${r.also_updated} other ${name} transactions` : `Moved to ${r.category}`)
          onNext ? onNext() : onClose()
        },
      },
    )

  const saveNotes = () => {
    if (notes !== (tx.notes || '')) update.mutate({ notes })
  }

  return (
    <Sheet open onClose={onClose} title="Transaction">
      <div className="flex flex-col items-center pb-5 text-center">
        <MerchantIcon name={name} logo={tx.logo_url} emoji={tx.category_emoji} color={tx.category_color} size={60} />
        <div className="mt-3 text-[15px] font-medium">{name}</div>
        <Amount value={tx.amount} className="mt-1 text-4xl tracking-tight" />
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[13px] text-muted">
          {dayLabel(tx.date)} · {tx.account}
          {tx.account_mask ? ` ••${tx.account_mask}` : ''}
          {!!tx.pending && <Badge>Pending</Badge>}
        </div>
        {tx.merchant && tx.merchant !== tx.description && <div className="mt-1 text-xs text-faint">{tx.description}</div>}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Category</span>
        {!tx.reviewed && (
          <Button size="sm" variant="soft" loading={update.isPending} onClick={() => update.mutate({ reviewed: true }, { onSuccess: () => (onNext ? onNext() : onClose()) })}>
            <Check size={14} /> Looks right
          </Button>
        )}
      </div>
      <CategoryPicker value={tx.category_id} onPick={pick} />
      <div className="mt-3 rounded-2xl bg-card-2 px-4 py-1">
        <Toggle checked={remember} onChange={setRemember} label={`Always categorize ${name} this way`} description="Applies to past and future transactions" />
      </div>

      <Field label="Notes" className="mt-4">
        <textarea className="input min-h-[70px] resize-none" value={notes} placeholder="Add a note" onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
      </Field>

      <div className="mt-5 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          className="text-bad"
          loading={remove.isPending}
          onClick={() => confirm(`Delete this ${money(tx.amount)} transaction?`) && remove.mutate()}
        >
          <Trash2 size={15} /> Delete transaction
        </Button>
      </div>
    </Sheet>
  )
}

export function AddTransactionSheet({ open, onClose }) {
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const [form, setForm] = useState({ direction: 'out', amount: '', description: '', date: isoDate(), account_id: '', category_id: '', notes: '' })
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }))
  const accountId = form.account_id || accounts[0]?.id
  const create = useAction((body) => api.post('/transactions', body), {
    onSuccess: () => {
      toast.success('Transaction added')
      setForm((f) => ({ ...f, amount: '', description: '', notes: '', category_id: '' }))
      onClose()
    },
  })
  const visibleCategories = useMemo(
    () => categories.filter((c) => (form.direction === 'in' ? c.kind !== 'expense' : c.kind !== 'income')),
    [categories, form.direction],
  )
  const submit = (e) => {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!amount || !form.description.trim() || !accountId) return toast.error('Add an amount, a description and an account.')
    create.mutate({
      account_id: Number(accountId),
      date: form.date,
      description: form.description,
      amount: form.direction === 'in' ? Math.abs(amount) : -Math.abs(amount),
      category_id: form.category_id ? Number(form.category_id) : null,
      notes: form.notes,
    })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add transaction">
      {accounts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Add an account first on the Accounts tab.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Segmented
            className="w-full"
            value={form.direction}
            onChange={set('direction')}
            options={[
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
          />
          <input
            className="tabular w-full bg-transparent py-2 text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-faint"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={set('amount')}
            autoFocus
          />
          <Field label="Description">
            <input className="input" placeholder="e.g. Lunch with Sam, cash" value={form.description} onChange={set('description')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input type="date" className="input" value={form.date} onChange={set('date')} />
            </Field>
            <Field label="Account">
              <select className="input" value={accountId} onChange={set('account_id')}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Category" hint="Leave on Automatic to use your rules">
            <select className="input" value={form.category_id} onChange={set('category_id')}>
              <option value="">Automatic</option>
              {visibleCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input className="input" value={form.notes} onChange={set('notes')} placeholder="Optional" />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={create.isPending}>
            Add transaction
          </Button>
        </form>
      )}
    </Sheet>
  )
}
