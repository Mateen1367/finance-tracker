import { useState } from 'react'
import { Download, Lock, Sparkles } from 'lucide-react'
import { api, useAction, useSettings } from '../lib/api'
import { toast } from '../lib/toast'
import { Badge, Button, Card, CardHeader, Field, PageHeader, Sheet, Skeleton } from '../components/ui'
import { PlaidSetup } from '../components/bank'

export default function SettingsPage() {
  const { data: settings } = useSettings()
  const [plaidOpen, setPlaidOpen] = useState(false)
  if (!settings) return <Skeleton className="h-96" />
  return (
    <>
      <PageHeader title="Settings" />
      <Profile settings={settings} />

      <Card className="mb-4">
        <CardHeader title="Bank connections (Plaid)" />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5">
          <div className="text-sm text-muted">
            {settings.plaid.configured ? (
              <>
                Connected to Plaid <Badge tone={settings.plaid.env === 'production' ? 'good' : 'warn'}>{settings.plaid.env}</Badge>
              </>
            ) : (
              'Not set up yet'
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={() => setPlaidOpen(true)}>
            {settings.plaid.configured ? 'Change keys' : 'Set up'}
          </Button>
        </div>
      </Card>

      <Demo settings={settings} />

      <Card className="mb-4">
        <CardHeader title="Your data" />
        <div className="space-y-3 px-5 pb-5 text-sm">
          <p className="flex gap-2 text-muted">
            <Lock size={16} className="mt-0.5 shrink-0 text-good" />
            Everything is stored in <code className="rounded bg-card-2 px-1">data/money.db</code> inside the app folder on this computer. Bank access tokens are encrypted,
            and bank connections are read-only.
          </p>
          <a
            href="/api/export.csv"
            className="inline-flex h-8 items-center gap-2 rounded-full border border-line bg-card px-3 text-[13px] font-medium transition hover:bg-card-2"
          >
            <Download size={15} /> Export all transactions (CSV)
          </a>
        </div>
      </Card>

      <Sheet open={plaidOpen} onClose={() => setPlaidOpen(false)} title="Plaid keys">
        <PlaidSetup settings={settings} onSaved={() => setPlaidOpen(false)} />
      </Sheet>
    </>
  )
}

function Profile({ settings }) {
  const [form, setForm] = useState({ name: settings.name, currency: settings.currency })
  const save = useAction((body) => api.put('/settings', body), { onSuccess: () => toast.success('Saved') })
  const dirty = form.name !== settings.name || form.currency !== settings.currency
  return (
    <Card className="mb-4">
      <CardHeader title="Profile" />
      <form
        className="grid gap-3 px-5 pb-5 sm:grid-cols-[1fr_120px_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(form)
        }}
      >
        <Field label="Your first name" hint="Used for the greeting on Home">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Currency symbol" hint={' '}>
          <input className="input" maxLength={4} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
        </Field>
        <Button type="submit" disabled={!dirty} loading={save.isPending} className="sm:mb-5">
          Save
        </Button>
      </form>
    </Card>
  )
}

function Demo({ settings }) {
  const load = useAction(() => api.post('/demo'), { onSuccess: () => toast.success('Demo data loaded') })
  const remove = useAction(() => api.del('/demo'), { onSuccess: () => toast.success('Demo data removed') })
  return (
    <Card className="mb-4">
      <CardHeader title="Demo data" />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5">
        <p className="max-w-md text-sm text-muted">Three sample accounts with six months of made-up transactions, budgets and loans, so you can try every feature.</p>
        {settings.demo ? (
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove demo data
          </Button>
        ) : (
          <Button variant="soft" size="sm" loading={load.isPending} onClick={() => load.mutate()}>
            <Sparkles size={15} /> Load demo data
          </Button>
        )}
      </div>
    </Card>
  )
}
