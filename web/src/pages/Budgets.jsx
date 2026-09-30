import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, Tags, Trash2, Wand2 } from 'lucide-react'
import { api, useAction, useCategories, useRules, useSummary } from '../lib/api'
import { currentMonth, money, parseDate } from '../lib/format'
import { toast } from '../lib/toast'
import { Button, Card, CardHeader, Field, MerchantIcon, MonthSwitcher, PageHeader, Progress, Ring, Segmented, Sheet, Skeleton } from '../components/ui'

const COLORS = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#ec4899', '#d946ef', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6', '#64748b', '#a8a29e']
const EMOJIS = ['🛒', '🍔', '☕', '🚗', '⛽', '🛍️', '🏠', '💡', '📺', '💊', '💇', '🎬', '✈️', '📚', '🎁', '💳', '🧾', '🐶', '👶', '🏋️', '🎮', '💼', '📱', '🍺', '📦']

export default function Budgets() {
  const [month, setMonth] = useState(currentMonth())
  const { data: s } = useSummary(month)
  const [editing, setEditing] = useState(null)
  const [managing, setManaging] = useState(false)

  if (!s) return <Skeleton className="h-96" />

  const budgeted = s.by_category.filter((c) => c.budget > 0)
  const other = s.by_category.filter((c) => c.budget <= 0 && c.spent > 0)
  const spent = budgeted.reduce((sum, c) => sum + c.spent, 0)
  const left = s.budget_total - spent
  const isCurrent = month === currentMonth()
  const start = parseDate(`${month}-01`)
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const daysLeft = isCurrent ? daysInMonth - new Date().getDate() + 1 : 0

  return (
    <>
      <PageHeader title="Budgets" subtitle="Monthly limits for the things you care about">
        <MonthSwitcher month={month} onChange={setMonth} />
      </PageHeader>

      <Card className="mb-4 flex flex-col items-center gap-6 p-6 sm:flex-row">
        <Ring value={spent} max={s.budget_total || 1} size={148} stroke={14}>
          <div>
            <div className="text-xs text-muted">{left >= 0 ? 'Left' : 'Over'}</div>
            <div className={`tabular text-2xl font-semibold tracking-tight ${left < 0 ? 'text-bad' : ''}`}>{money(Math.abs(left), { whole: true })}</div>
          </div>
        </Ring>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 self-stretch sm:content-center">
          <div>
            <div className="text-[13px] text-muted">Spent on budgets</div>
            <div className="tabular text-lg font-semibold">{money(spent, { whole: true })}</div>
          </div>
          <div>
            <div className="text-[13px] text-muted">Total budget</div>
            <div className="tabular text-lg font-semibold">{money(s.budget_total, { whole: true })}</div>
          </div>
          {isCurrent && left > 0 && (
            <div>
              <div className="text-[13px] text-muted">Per day, for {daysLeft} days</div>
              <div className="tabular text-lg font-semibold">{money(left / daysLeft, { whole: true })}</div>
            </div>
          )}
          <div>
            <div className="text-[13px] text-muted">All spending</div>
            <div className="tabular text-lg font-semibold">{money(s.spending, { whole: true })}</div>
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Budgets"
          action={
            <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
              <Tags size={15} /> Categories & rules
            </Button>
          }
        />
        {budgeted.length === 0 && <p className="px-5 pb-6 text-sm text-muted">No budgets yet. Pick a category below and set a monthly limit.</p>}
        <div className="divide-y divide-line">
          {budgeted.map((c) => {
            const remaining = c.budget - c.spent
            return (
              <button key={c.id} onClick={() => setEditing(c)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-card-2">
                <MerchantIcon emoji={c.emoji} color={c.color} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="tabular text-sm">
                      <span className="font-semibold">{money(c.spent, { whole: true })}</span>
                      <span className="text-muted"> / {money(c.budget, { whole: true })}</span>
                    </span>
                  </div>
                  <Progress className="mt-2" value={c.spent} max={c.budget} />
                  <div className="mt-1 text-xs" style={{ color: remaining < 0 ? 'var(--bad)' : 'var(--muted)' }}>
                    {remaining >= 0 ? `${money(remaining, { whole: true })} left` : `${money(-remaining, { whole: true })} over budget`}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </Card>

      {other.length > 0 && (
        <Card>
          <CardHeader title="Not budgeted" />
          <div className="divide-y divide-line">
            {other.map((c) => (
              <div key={c.id ?? 'none'} className="flex items-center gap-3 px-5 py-3">
                <MerchantIcon emoji={c.emoji} color={c.color} size={36} />
                <Link to={`/transactions?category=${c.id ?? 'none'}&month=${month}`} className="flex-1 truncate font-medium">
                  {c.name}
                </Link>
                <span className="tabular text-sm font-semibold">{money(c.spent, { whole: true })}</span>
                {c.id && (
                  <Button size="sm" variant="soft" onClick={() => setEditing(c)}>
                    Set budget
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {editing && <BudgetSheet category={editing} onClose={() => setEditing(null)} />}
      <ManageSheet open={managing} onClose={() => setManaging(false)} />
    </>
  )
}

function BudgetSheet({ category, onClose }) {
  const [value, setValue] = useState(category.budget ? String(category.budget) : String(Math.ceil(category.spent / 10) * 10 || ''))
  const save = useAction((budget) => api.patch(`/categories/${category.id}`, { budget }), {
    onSuccess: () => {
      toast.success('Budget saved')
      onClose()
    },
  })
  return (
    <Sheet open onClose={onClose} title={`${category.emoji} ${category.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(Math.max(0, parseFloat(value) || 0))
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">
          You've spent <b className="text-ink">{money(category.spent)}</b> on {category.name.toLowerCase()} this month.
        </p>
        <Field label="Monthly budget">
          <input className="input tabular text-2xl font-semibold" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" size="lg" loading={save.isPending}>
            Save budget
          </Button>
          {category.budget > 0 && (
            <Button type="button" variant="danger" size="lg" onClick={() => save.mutate(0)}>
              Remove
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

function ManageSheet({ open, onClose }) {
  const [tab, setTab] = useState('categories')
  const [editing, setEditing] = useState(null)
  const { data: categories = [] } = useCategories()
  const { data: rules = [] } = useRules()
  const [rule, setRule] = useState({ pattern: '', category_id: '' })
  const addRule = useAction((body) => api.post('/rules', body), {
    onSuccess: (r) => {
      toast.success(`Rule added. ${r.updated} transactions updated`)
      setRule({ pattern: '', category_id: '' })
    },
  })
  const deleteRule = useAction((id) => api.del(`/rules/${id}`))

  return (
    <Sheet open={open} onClose={onClose} title="Categories & rules" wide>
      <Segmented
        className="mb-4 w-full"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'categories', label: 'Categories' },
          { value: 'rules', label: 'Auto-categorize rules' },
        ]}
      />
      {tab === 'categories' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <button key={c.id} onClick={() => setEditing(c)} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5 text-left transition hover:bg-card-2">
                <MerchantIcon emoji={c.emoji} color={c.color} size={34} />
                <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs text-faint capitalize">{c.kind}</span>
              </button>
            ))}
          </div>
          <Button variant="soft" className="mt-4 w-full" onClick={() => setEditing({ name: '', kind: 'expense', emoji: '📦', color: '#6366f1', budget: 0 })}>
            <Plus size={16} /> New category
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            When a transaction's merchant or description contains the text, it gets that category automatically. Tip: in any transaction, turn on
            "Always categorize this way" to create one.
          </p>
          <form
            className="mb-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault()
              if (rule.pattern.trim() && rule.category_id) addRule.mutate({ pattern: rule.pattern, category_id: Number(rule.category_id) })
            }}
          >
            <input className="input" placeholder="Contains… e.g. UBER" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} />
            <select className="input" value={rule.category_id} onChange={(e) => setRule({ ...rule, category_id: e.target.value })}>
              <option value="">Category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
            <Button type="submit" loading={addRule.isPending}>
              <Wand2 size={15} /> Add
            </Button>
          </form>
          <div className="divide-y divide-line rounded-2xl border border-line">
            {rules.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No rules yet.</p>}
            {rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 truncate">
                  contains <b>{r.pattern}</b>
                </span>
                <span className="text-muted">
                  {r.emoji} {r.category}
                </span>
                <button className="text-faint hover:text-bad" onClick={() => deleteRule.mutate(r.id)} aria-label="Delete rule">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {editing && <CategorySheet category={editing} onClose={() => setEditing(null)} />}
    </Sheet>
  )
}

function CategorySheet({ category, onClose }) {
  const [form, setForm] = useState(category)
  const isNew = !category.id
  const save = useAction((body) => (isNew ? api.post('/categories', body) : api.patch(`/categories/${category.id}`, body)), {
    onSuccess: () => {
      toast.success(isNew ? 'Category created' : 'Category saved')
      onClose()
    },
  })
  const remove = useAction(() => api.del(`/categories/${category.id}`), { onSuccess: onClose })
  return (
    <Sheet open onClose={onClose} title={isNew ? 'New category' : 'Edit category'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name.trim()) return toast.error('Give it a name')
          save.mutate({ name: form.name, kind: form.kind, emoji: form.emoji, color: form.color, budget: Number(form.budget) || 0 })
        }}
      >
        <div className="flex items-center gap-3">
          <MerchantIcon emoji={form.emoji} color={form.color} size={52} />
          <input className="input text-lg font-medium" placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={isNew} />
        </div>
        <Field label="Icon">
          <div className="flex flex-wrap gap-1.5">
            {EMOJIS.map((em) => (
              <button type="button" key={em} onClick={() => setForm({ ...form, emoji: em })} className={`grid size-10 place-items-center rounded-xl text-xl transition ${form.emoji === em ? 'bg-accent-soft ring-2 ring-accent' : 'bg-card-2 hover:brightness-95'}`}>
                {em}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setForm({ ...form, color: c })} className="size-8 rounded-full transition" style={{ background: c, boxShadow: form.color === c ? `0 0 0 3px var(--card), 0 0 0 5px ${c}` : 'none' }} aria-label={c} />
            ))}
          </div>
        </Field>
        <Field label="Type" hint="Transfers (like paying your own credit card) don't count as spending or income.">
          <Segmented
            value={form.kind}
            onChange={(kind) => setForm({ ...form, kind })}
            options={[
              { value: 'expense', label: 'Spending' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="lg" className="flex-1" loading={save.isPending}>
            Save
          </Button>
          {!isNew && (
            <Button
              type="button"
              size="lg"
              variant="danger"
              onClick={() => confirm(`Delete ${category.name}? Its transactions become uncategorized.`) && remove.mutate()}
            >
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

