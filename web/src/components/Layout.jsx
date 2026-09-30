import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeftRight, ChartPie, House, Landmark, Repeat, Settings, TrendingDown } from 'lucide-react'
import { api, useSettings } from '../lib/api'
import { setCurrencySymbol } from '../lib/format'
import { Toaster } from '../lib/toast'

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/budgets', label: 'Budgets', icon: ChartPie },
  { to: '/debts', label: 'Debts', icon: TrendingDown },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
]
const DESKTOP_EXTRA = [
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Logo({ size = 32 }) {
  return <img src="/icon.svg" alt="" width={size} height={size} className="rounded-[10px]" />
}

export default function Layout() {
  const { data: settings } = useSettings()
  const queryClient = useQueryClient()

  // Quietly pull new bank transactions when the app opens (at most every 6 hours).
  useEffect(() => {
    api
      .post('/plaid/sync?max_age=21600')
      .then((r) => r.results?.length && queryClient.invalidateQueries())
      .catch(() => {})
  }, [queryClient])

  if (!settings) return <div className="min-h-dvh bg-bg" />
  setCurrencySymbol(settings.currency)

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-card px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <Logo />
          <span className="text-[17px] font-semibold tracking-tight">My Money</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {[...NAV, ...DESKTOP_EXTRA].map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition',
                  isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-card-2 hover:text-ink',
                  to === '/settings' && 'mt-auto',
                )
              }
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="pb-28 md:pb-12 md:pl-60">
        <div className="mx-auto max-w-5xl px-4 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-8 md:pt-8">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx('flex flex-col items-center gap-0.5 pt-2.5 pb-2 text-[10.5px] font-medium transition', isActive ? 'text-accent' : 'text-faint')
            }
          >
            <Icon size={22} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
      <Toaster />
    </div>
  )
}
