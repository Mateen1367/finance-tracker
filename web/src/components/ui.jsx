import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, LoaderCircle, Settings, X } from 'lucide-react'
import { currentMonth, money, monthLabel, shiftMonth } from '../lib/format'

export function Card({ className, children, ...props }) {
  return (
    <div className={clsx('rounded-3xl border border-line bg-card shadow-[0_1px_2px_rgba(16,24,40,0.04)]', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ title, action, className }) {
  return (
    <div className={clsx('flex items-center justify-between px-5 pt-4 pb-2', className)}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight md:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        <Link to="/settings" aria-label="Settings" className="grid size-10 place-items-center rounded-full text-muted hover:bg-card md:hidden">
          <Settings size={20} />
        </Link>
      </div>
    </header>
  )
}

const buttonStyles = {
  primary: 'bg-accent text-white hover:brightness-110 shadow-sm',
  secondary: 'bg-card border border-line text-ink hover:bg-card-2',
  soft: 'bg-accent-soft text-accent hover:brightness-95',
  ghost: 'text-muted hover:bg-card-2 hover:text-ink',
  danger: 'bg-bad/10 text-bad hover:bg-bad/15',
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-sm',
        buttonStyles[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderCircle size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function IconButton({ className, children, ...props }) {
  return (
    <button className={clsx('grid size-9 place-items-center rounded-full text-muted transition hover:bg-card-2 hover:text-ink', className)} {...props}>
      {children}
    </button>
  )
}

export function Sheet({ open, onClose, title, children, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div className="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'animate-sheet relative flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-card shadow-2xl md:rounded-[28px]',
          wide ? 'md:max-w-2xl' : 'md:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line md:hidden" />
        <div className="flex shrink-0 items-center justify-between px-5 pt-2 pb-1 md:pt-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton onClick={onClose} aria-label="Close">
            <X size={20} />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function MerchantIcon({ name, logo, emoji, color, size = 40 }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (logo && !broken) {
    return <img src={logo} alt="" style={style} className="shrink-0 rounded-full bg-white object-cover ring-1 ring-line" onError={() => setBroken(true)} />
  }
  return (
    <div
      style={{ ...style, background: `${color || '#98a2b3'}22`, fontSize: size * 0.45 }}
      className="grid shrink-0 place-items-center rounded-full"
    >
      {emoji || <span className="font-semibold text-muted">{(name || '?').trim().charAt(0).toUpperCase()}</span>}
    </div>
  )
}

export function Amount({ value, className, signed = true, whole }) {
  return (
    <span className={clsx('tabular font-semibold', value > 0 ? 'text-good' : 'text-ink', className)}>
      {money(value, { signed: signed && value > 0, whole })}
    </span>
  )
}

export function MonthSwitcher({ month, onChange }) {
  const atCurrent = month >= currentMonth()
  return (
    <div className="flex items-center rounded-full border border-line bg-card p-1 shadow-sm">
      <IconButton className="size-8" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month">
        <ChevronLeft size={18} />
      </IconButton>
      <span className="min-w-[92px] text-center text-sm font-medium">{monthLabel(month, { short: true })}</span>
      <IconButton className="size-8 disabled:opacity-30" disabled={atCurrent} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month">
        <ChevronRight size={18} />
      </IconButton>
    </div>
  )
}

export function budgetColor(ratio) {
  return ratio > 1 ? 'var(--bad)' : ratio > 0.85 ? 'var(--warn)' : 'var(--good)'
}

export function Progress({ value, max, color, className }) {
  const ratio = max > 0 ? value / max : 0
  return (
    <div className={clsx('h-2 overflow-hidden rounded-full bg-card-2', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.min(ratio, 1) * 100}%`, background: color || budgetColor(ratio) }}
      />
    </div>
  )
}

export function Ring({ value, max, size = 120, stroke = 12, color, children }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = max > 0 ? Math.min(value / max, 1) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--card-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color || budgetColor(max > 0 ? value / max : 0)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={clsx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Segmented({ options, value, onChange, className }) {
  return (
    <div className={clsx('inline-flex rounded-full bg-card-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex-1 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition',
            value === o.value ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span className={clsx('relative h-6 w-10 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}>
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && (
        <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Icon size={22} />
        </div>
      )}
      <p className="font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  )
}

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded-2xl bg-card-2', className)} />
}

export function Badge({ children, tone = 'muted' }) {
  const tones = {
    muted: 'bg-card-2 text-muted',
    accent: 'bg-accent-soft text-accent',
    good: 'bg-good/12 text-good',
    warn: 'bg-warn/12 text-warn',
    bad: 'bg-bad/12 text-bad',
  }
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>
}

export function Stat({ label, value, sub, className }) {
  return (
    <div className={className}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="tabular mt-0.5 text-xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}
