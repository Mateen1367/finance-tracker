import { useState } from 'react'
import { useSearchParams } from 'react-router'
import clsx from 'clsx'
import { CircleAlert, EyeOff, FileUp, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, useAccounts, useAction, useItems, useSettings, useSummary } from '../lib/api'
import { currentMonth, money, timeAgo } from '../lib/format'
import { toast } from '../lib/toast'
import { Badge, Button, Card, CardHeader, Field, PageHeader, Segmented, Sheet, Skeleton, Toggle } from '../components/ui'
import { accountGroups, ConnectBankButton, ImportSheet, PlaidSetup } from '../components/bank'

export default function Accounts() {
  const [params, setParams] = useSearchParams()
  const { data: accounts } = useAccounts()
  const { data: items = [] } = useItems()
  const { data: settings } = useSettings()
  const { data: summary } = useSummary(currentMonth())
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [setup, setSetup] = useState(params.get('setup') === '1')
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState(null)
  const autoConnect = params.get('connect') === '1'

  const sync = useAction(() => api.post('/plaid/sync'), {
    onSuccess: (r) => {
      const errors = r.results.filter((x) => x.error)
      if (errors.length) toast.error(`${errors[0].institution}: ${errors[0].error}`)
      else toast.success(`Synced · ${r.results.reduce((s, x) => s + (x.added || 0), 0)} new transactions`)
    },
  })
  const removeItem = useAction((id) => api.del(`/items/${id}`), { onSuccess: () => toast.success('Bank disconnected') })

  if (!accounts || !settings) return <Skeleton className="h-96" />
  const plaidReady = settings.plaid.configured
  const clearParams = () => setParams({}, { replace: true })

  return (
    <>
      <PageHeader title="Accounts" subtitle="Balances across everything you own and owe">
        <div className="hidden sm:block">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <FileUp size={16} /> Import CSV
          </Button>
        </div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Manual
        </Button>
      </PageHeader>

      {summary && (
        <Card className="mb-4 p-5">
          <div className="text-[13px] text-muted">Net worth</div>
          <div className={clsx('tabular text-[34px] leading-tight font-semibold tracking-tight', summary.net_worth < 0 && 'text-bad')}>{money(summary.net_worth)}</div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-card-2">
            <div className="bg-good" style={{ width: `${(summary.assets / (summary.assets + summary.liabilities || 1)) * 100}%` }} />
            <div className="bg-bad" style={{ width: `${(summary.liabilities / (summary.assets + summary.liabilities || 1)) * 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[13px]">
            <span className="text-muted">
              <span className="mr-1.5 inline-block size-2 rounded-full bg-good" />
              Assets <b className="tabular text-ink">{money(summary.assets, { whole: true })}</b>
            </span>
            <span className="text-muted">
              <span className="mr-1.5 inline-block size-2 rounded-full bg-bad" />
              Debts <b className="tabular text-ink">{money(summary.liabilities, { whole: true })}</b>
            </span>
          </div>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader
          title="Bank connections"
          action={
            items.length > 0 && (
              <Button size="sm" variant="ghost" loading={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw size={14} /> Sync now
              </Button>
            )
          }
        />
        <div className="px-5 pb-5">
          {!plaidReady ? (
            <div className="rounded-2xl bg-card-2 p-4">
              <p className="text-sm">
                Link your bank so transactions and balances update on their own. It takes a one-time setup with <b>Plaid</b>, the service apps like Venmo and Rocket
                Money use.
              </p>
              <Button className="mt-3" onClick={() => setSetup(true)}>
                Set up bank connections
              </Button>
            </div>
          ) : (
            <>
              {items.map((item) => (
                <div key={item.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                  <div className="grid size-10 place-items-center rounded-xl bg-accent-soft font-semibold text-accent">{item.institution_name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.institution_name}</div>
                    <div className="text-[13px] text-muted">
                      {item.account_count} account{item.account_count === 1 ? '' : 's'} · synced {timeAgo(item.last_synced)}
                    </div>
                    {item.error && (
                      <div className="mt-1 flex items-center gap-1 text-[13px] text-bad">
                        <CircleAlert size={13} /> {item.error}
                      </div>
                    )}
                  </div>
                  <button
                    className="text-faint transition hover:text-bad"
                    aria-label={`Disconnect ${item.institution_name}`}
                    onClick={() => confirm(`Disconnect ${item.institution_name}? Its accounts and transactions will be removed from this app.`) && removeItem.mutate(item.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <ConnectBankButton autoStart={autoConnect}>{items.length ? 'Connect another bank' : 'Connect a bank'}</ConnectBankButton>
                {settings.plaid.env === 'sandbox' && (
                  <span className="text-xs text-muted">
                    Sandbox mode: pick any bank and sign in with <code className="rounded bg-card-2 px-1">user_good</code> / <code className="rounded bg-card-2 px-1">pass_good</code>
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </Card>

      {accounts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No accounts yet. Connect a bank or add one manually.</Card>
      ) : (
        accountGroups(accounts).map((group) => (
          <Card key={group.title} className="mb-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-[15px] font-semibold">{group.title}</h2>
              <span className="tabular text-[15px] font-semibold">{money(group.total)}</span>
            </div>
            <div className="divide-y divide-line">
              {group.items.map((a) => (
                <button key={a.id} onClick={() => setEditing(a)} className={clsx('flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-card-2', a.hidden && 'opacity-50')}>
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-card-2 text-sm font-semibold text-muted">{(a.institution || a.name).charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{a.name}</span>
                      {a.mask && <span className="text-[13px] text-faint">••{a.mask}</span>}
                      {!!a.hidden && <EyeOff size={13} className="text-faint" />}
                    </div>
                    <div className="truncate text-[13px] text-muted">
                      {a.institution || 'Manual account'}
                      {a.item_id ? '' : ` · ${a.transaction_count} transactions`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={clsx('tabular font-semibold', a.balance < 0 && 'text-bad')}>{money(a.balance)}</div>
                    {a.item_id ? <Badge tone="accent">Synced</Badge> : a.is_demo ? <Badge>Demo</Badge> : null}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        ))
      )}

      <div className="sm:hidden">
        <Button variant="secondary" className="w-full" onClick={() => setImporting(true)}>
          <FileUp size={16} /> Import a CSV statement
        </Button>
      </div>

      <Sheet
        open={setup}
        onClose={() => {
          setSetup(false)
          clearParams()
        }}
        title="Set up bank connections"
      >
        <PlaidSetup settings={settings} onSaved={() => setSetup(false)} />
      </Sheet>
      <AddAccountSheet
        open={adding}
        types={settings.account_types}
        onClose={() => {
          setAdding(false)
          clearParams()
        }}
      />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      {editing && <AccountSheet account={editing} types={settings.account_types} onClose={() => setEditing(null)} onImport={() => setImporting(true)} />}
    </>
  )
}

function AddAccountSheet({ open, onClose, types }) {
  const [form, setForm] = useState({ name: '', type: 'Checking', institution: '', opening_balance: '' })
  const create = useAction((body) => api.post('/accounts', body), {
    onSuccess: () => {
      toast.success('Account added')
      setForm({ name: '', type: 'Checking', institution: '', opening_balance: '' })
      onClose()
    },
  })
  const owes = form.type === 'Credit Card' || form.type === 'Loan'
  return (
    <Sheet open={open} onClose={onClose} title="Add a manual account">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name.trim()) return toast.error('Give the account a name')
          const balance = Number(form.opening_balance) || 0
          create.mutate({ ...form, opening_balance: owes ? -Math.abs(balance) : balance })
        }}
      >
        <Field label="Name">
          <input className="input" placeholder="e.g. Cash wallet, Credit union checking" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Bank (optional)">
            <input className="input" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
          </Field>
        </div>
        <Field label={owes ? 'Amount owed right now' : 'Starting balance'} hint="The balance before the first transaction you'll add or import.">
          <input className="input tabular" inputMode="decimal" placeholder="0.00" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={create.isPending}>
          Add account
        </Button>
      </form>
    </Sheet>
  )
}

function AccountSheet({ account, types, onClose, onImport }) {
  const manual = !account.item_id
  const [form, setForm] = useState({ name: account.name, type: account.type, opening_balance: account.opening_balance })
  const update = useAction((body) => api.patch(`/accounts/${account.id}`, body), {
    onSuccess: () => {
      toast.success('Account saved')
      onClose()
    },
  })
  const remove = useAction(() => api.del(`/accounts/${account.id}`), {
    onSuccess: () => {
      toast.success('Account deleted')
      onClose()
    },
  })
  return (
    <Sheet open onClose={onClose} title={account.name}>
      <div className="mb-5 text-center">
        <div className="text-[13px] text-muted">Current balance</div>
        <div className={clsx('tabular text-4xl font-semibold tracking-tight', account.balance < 0 && 'text-bad')}>{money(account.balance)}</div>
        {!manual && <div className="mt-1 text-xs text-muted">From {account.institution}, synced {timeAgo(account.last_synced)}</div>}
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          update.mutate(manual ? { ...form, opening_balance: Number(form.opening_balance) || 0 } : { name: form.name })
        }}
      >
        <Field label="Name">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        {manual && (
          <>
            <Field label="Type">
              <Segmented className="flex w-full flex-wrap" value={form.type} onChange={(type) => setForm({ ...form, type })} options={types.map((t) => ({ value: t, label: t }))} />
            </Field>
            <Field label="Starting balance" hint="Current balance = starting balance + all transactions in this account.">
              <input className="input tabular" inputMode="decimal" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
            </Field>
          </>
        )}
        <div className="rounded-2xl bg-card-2 px-4">
          <Toggle
            checked={!!account.hidden}
            onChange={(hidden) => update.mutate({ hidden })}
            label="Hide from net worth"
            description="Useful for accounts you don't want counted, like a joint account"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={update.isPending}>
          Save
        </Button>
      </form>
      {manual && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              onClose()
              onImport()
            }}
          >
            <FileUp size={15} /> Import CSV
          </Button>
          <Button variant="danger" onClick={() => confirm(`Delete ${account.name} and all of its ${account.transaction_count} transactions?`) && remove.mutate()}>
            <Trash2 size={15} /> Delete
          </Button>
        </div>
      )}
    </Sheet>
  )
}
