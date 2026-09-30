import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileUp, Link2, ShieldCheck } from 'lucide-react'
import { api, useAccounts, useAction } from '../lib/api'
import { toast } from '../lib/toast'
import { Button, Field, Segmented, Sheet, Toggle } from './ui'

export function ConnectBankButton({ children = 'Connect a bank', autoStart, variant = 'primary', size, className }) {
  const [token, setToken] = useState(null)
  const [status, setStatus] = useState(null) // null | 'starting' | 'importing'
  const queryClient = useQueryClient()
  const started = useRef(false)

  const onSuccess = useCallback(
    async (publicToken, metadata) => {
      setStatus('importing')
      try {
        await api.post('/plaid/exchange', {
          public_token: publicToken,
          institution_id: metadata?.institution?.institution_id,
          institution_name: metadata?.institution?.name,
        })
        toast.success(`${metadata?.institution?.name || 'Bank'} connected`)
        await queryClient.invalidateQueries()
      } catch (e) {
        toast.error(e.message)
      } finally {
        setStatus(null)
        setToken(null)
      }
    },
    [queryClient],
  )

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit: () => {
      setToken(null)
      setStatus(null)
    },
  })

  useEffect(() => {
    if (token && ready) {
      open()
      setStatus((s) => (s === 'starting' ? null : s))
    }
  }, [token, ready, open])

  const start = useCallback(async () => {
    setStatus('starting')
    try {
      const { link_token } = await api.post('/plaid/link-token')
      setToken(link_token)
    } catch (e) {
      toast.error(e.message)
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true
      start()
    }
  }, [autoStart, start])

  return (
    <Button variant={variant} size={size} className={className} loading={!!status} onClick={start}>
      {!status && <Link2 size={16} />}
      {status === 'importing' ? 'Importing your transactions…' : children}
    </Button>
  )
}

export function PlaidSetup({ settings, onSaved }) {
  const [form, setForm] = useState({ client_id: '', secret: '', env: settings?.plaid?.env || 'sandbox' })
  const save = useAction((body) => api.put('/plaid/keys', body), {
    onSuccess: () => {
      toast.success('Plaid keys saved')
      onSaved?.()
    },
  })
  return (
    <div className="space-y-4">
      <ol className="space-y-2.5 text-sm">
        {[
          <>
            Create a free Plaid account at{' '}
            <a className="font-medium text-accent underline-offset-2 hover:underline" href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer">
              dashboard.plaid.com <ExternalLink size={12} className="inline" />
            </a>
          </>,
          <>
            In the dashboard, open <b>Developers → Keys</b>
          </>,
          <>
            Copy your <b>client_id</b> and the <b>Sandbox</b> secret into the boxes below
          </>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
            <span className="pt-0.5 text-muted">{step}</span>
          </li>
        ))}
      </ol>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(form)
        }}
      >
        <Field label="Client ID">
          <input className="input font-mono text-[13px]" autoComplete="off" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
        </Field>
        <Field label="Secret">
          <input type="password" className="input font-mono text-[13px]" autoComplete="off" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
        </Field>
        <Field label="Environment" hint="Sandbox uses fake test banks. Switch to Production once Plaid approves you for real banks.">
          <Segmented
            value={form.env}
            onChange={(env) => setForm({ ...form, env })}
            options={[
              { value: 'sandbox', label: 'Sandbox (testing)' },
              { value: 'production', label: 'Production (real banks)' },
            ]}
          />
        </Field>
        <Button type="submit" className="w-full" loading={save.isPending}>
          Save keys
        </Button>
      </form>
      <p className="flex gap-2 text-xs text-muted">
        <ShieldCheck size={15} className="shrink-0 text-good" />
        Keys are stored only in the .env file on this computer. Bank logins happen inside Plaid's secure window, so your bank password never touches this app.
      </p>
    </div>
  )
}

export function ImportSheet({ open, onClose, defaultAccountId }) {
  const { data: accounts = [] } = useAccounts()
  const manualAccounts = accounts.filter((a) => !a.item_id)
  const [file, setFile] = useState(null)
  const [skipRows, setSkipRows] = useState(0)
  const [preview, setPreview] = useState(null)
  const [map, setMap] = useState({})
  const [accountId, setAccountId] = useState(defaultAccountId || '')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const account = accountId || manualAccounts[0]?.id

  const reset = () => {
    setFile(null)
    setPreview(null)
    setSkipRows(0)
  }
  const close = () => {
    reset()
    onClose()
  }

  const loadPreview = async (f = file, skip = skipRows) => {
    if (!f) return
    const body = new FormData()
    body.append('file', f)
    body.append('skip_rows', skip)
    try {
      const p = await api.post('/import/preview', body)
      setPreview(p)
      setMap({
        date: p.guess.date || p.columns[0],
        description: p.guess.description || p.columns[1] || p.columns[0],
        mode: p.guess.amount || !(p.guess.debit && p.guess.credit) ? 'single' : 'split',
        amount: p.guess.amount || p.columns[2] || p.columns[0],
        debit: p.guess.debit || p.columns[0],
        credit: p.guess.credit || p.columns[0],
        flip: false,
        dayfirst: false,
      })
    } catch (e) {
      toast.error(e.message)
    }
  }

  const commit = async () => {
    const body = new FormData()
    body.append('file', file)
    body.append('account_id', account)
    body.append('skip_rows', skipRows)
    body.append('date_col', map.date)
    body.append('description_col', map.description)
    if (map.mode === 'single') body.append('amount_col', map.amount)
    else {
      body.append('debit_col', map.debit)
      body.append('credit_col', map.credit)
    }
    body.append('flip', map.flip)
    body.append('dayfirst', map.dayfirst)
    setBusy(true)
    try {
      const r = await api.post('/import/commit', body)
      await queryClient.invalidateQueries()
      toast.success(`Imported ${r.inserted} transactions${r.duplicates ? ` (${r.duplicates} duplicates skipped)` : ''}`)
      close()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const column = (key, label) => (
    <Field label={label}>
      <select className="input" value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        {preview.columns.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  )

  return (
    <Sheet open={open} onClose={close} title="Import a bank statement" wide>
      {manualAccounts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Add a manual account first. Bank-connected accounts sync on their own.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Import into">
            <select className="input" value={account} onChange={(e) => setAccountId(e.target.value)}>
              {manualAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-7 text-center transition hover:border-accent hover:bg-accent-soft/40">
            <FileUp className="text-accent" />
            <span className="text-sm font-medium">{file ? file.name : 'Choose a CSV file'}</span>
            <span className="text-xs text-muted">Download it from your bank's website. Re-importing the same file is safe.</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setFile(f)
                loadPreview(f, skipRows)
              }}
            />
          </label>

          {preview && (
            <>
              <div className="overflow-x-auto rounded-2xl border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-card-2 text-muted">
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-line">
                        {preview.columns.map((c) => (
                          <td key={c} className="max-w-[180px] truncate px-3 py-2 whitespace-nowrap">
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Field label="Rows to skip at the top" hint="Use this if your bank puts a title block above the column names.">
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={skipRows}
                  onChange={(e) => {
                    const n = Number(e.target.value) || 0
                    setSkipRows(n)
                    loadPreview(file, n)
                  }}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {column('date', 'Date column')}
                {column('description', 'Description column')}
              </div>
              <Segmented
                value={map.mode}
                onChange={(mode) => setMap({ ...map, mode })}
                options={[
                  { value: 'single', label: 'One amount column' },
                  { value: 'split', label: 'Debit + credit columns' },
                ]}
              />
              {map.mode === 'single' ? (
                <>
                  {column('amount', 'Amount column')}
                  <Toggle checked={map.flip} onChange={(flip) => setMap({ ...map, flip })} label="Spending shows as positive numbers" description="Common on credit card statements" />
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {column('debit', 'Money out (debit)')}
                  {column('credit', 'Money in (credit)')}
                </div>
              )}
              <Toggle checked={map.dayfirst} onChange={(dayfirst) => setMap({ ...map, dayfirst })} label="Dates are day-first" description="31/12/2025 instead of 12/31/2025" />
              <Button size="lg" className="w-full" loading={busy} onClick={commit}>
                Import transactions
              </Button>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}

export function accountGroups(accounts) {
  const groups = [
    ['Cash', ['Checking', 'Savings', 'Cash']],
    ['Credit cards', ['Credit Card']],
    ['Loans', ['Loan']],
    ['Investments', ['Investment']],
    ['Other', ['Other']],
  ]
  return groups
    .map(([title, types]) => {
      const items = accounts.filter((a) => types.includes(a.type))
      return { title, items, total: items.filter((a) => !a.hidden).reduce((s, a) => s + a.balance, 0) }
    })
    .filter((g) => g.items.length)
}

