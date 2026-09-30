import { Link } from 'react-router'
import { Repeat } from 'lucide-react'
import { useRecurring } from '../lib/api'
import { daysUntil, money, relativeDays, shortDate } from '../lib/format'
import { Badge, Card, CardHeader, Empty, MerchantIcon, PageHeader, Skeleton } from '../components/ui'

export default function Recurring() {
  const { data } = useRecurring()
  if (!data) return <Skeleton className="h-96" />
  const soon = data.items.filter((r) => daysUntil(r.next_expected) <= 7).sort((a, b) => a.next_expected.localeCompare(b.next_expected))
  const later = data.items.filter((r) => daysUntil(r.next_expected) > 7).sort((a, b) => a.next_expected.localeCompare(b.next_expected))

  return (
    <>
      <PageHeader title="Recurring" subtitle="Bills and subscriptions found automatically in your history" />
      {data.items.length === 0 ? (
        <Card>
          <Empty icon={Repeat} title="Nothing recurring yet" text="Once a charge shows up at least three times on a regular schedule, it will appear here." />
        </Card>
      ) : (
        <>
          <Card className="mb-4 grid grid-cols-3 divide-x divide-line p-5 text-center">
            <div>
              <div className="text-[13px] text-muted">Per month</div>
              <div className="tabular text-xl font-semibold tracking-tight">{money(data.monthly_total, { whole: true })}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Per year</div>
              <div className="tabular text-xl font-semibold tracking-tight">{money(data.monthly_total * 12, { whole: true })}</div>
            </div>
            <div>
              <div className="text-[13px] text-muted">Tracked</div>
              <div className="tabular text-xl font-semibold tracking-tight">{data.items.length}</div>
            </div>
          </Card>
          {[
            ['Next 7 days', soon],
            ['Later', later],
          ].map(([title, items]) =>
            items.length ? (
              <Card key={title} className="mb-4 overflow-hidden">
                <CardHeader title={title} />
                <div className="divide-y divide-line">
                  {items.map((r) => (
                    <Link key={r.merchant} to={`/transactions?q=${encodeURIComponent(r.merchant)}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-card-2">
                      <MerchantIcon name={r.merchant} logo={r.logo_url} emoji={r.category_emoji} color={r.category_color} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{r.merchant}</div>
                        <div className="flex items-center gap-1.5 text-[13px] text-muted">
                          <Badge>{r.frequency}</Badge>
                          next {shortDate(r.next_expected)} · {relativeDays(r.next_expected)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular font-semibold">{money(r.avg_amount)}</div>
                        {r.frequency !== 'Monthly' && <div className="tabular text-xs text-muted">{money(r.monthly_cost)}/mo</div>}
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            ) : null,
          )}
        </>
      )}
    </>
  )
}
