import { useEffect, useMemo, useRef, useState } from 'react'
import type { Exchange, Market, MarketGroup } from '../lib/types'
import { fmtCompact, fmtPrice, groupLabel } from '../lib/format'

interface Props {
  markets: Market[]
  value: Market
  marks: Map<string, number>
  onChange: (m: Market) => void
}

const EXCHANGES: Array<{ id: Exchange | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'binance', label: 'Binance' },
  { id: 'okx', label: 'OKX' },
]

const GROUPS: Array<{ id: MarketGroup | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'usdt', label: 'USDT 永续' },
  { id: 'usdc', label: 'USDⓈ 永续' },
  { id: 'coinm', label: '币本位' },
]

export function MarketPicker({ markets, value, marks, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [exchange, setExchange] = useState<Exchange | 'all'>('all')
  const [group, setGroup] = useState<MarketGroup | 'all'>('all')
  const [cursor, setCursor] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      if (next) {
        setQuery('')
        setCursor(0)
        requestAnimationFrame(() => inputRef.current?.focus())
      }
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase()
    return markets
      .filter((m) => (exchange === 'all' ? true : m.exchange === exchange))
      .filter((m) => (group === 'all' ? true : m.group === group))
      .filter((m) => {
        if (!q) return true
        if (m.base.startsWith(q)) return true
        if (m.id.toUpperCase().includes(q)) return true
        return false
      })
      .sort((a, b) => {
        const q2 = query.trim().toUpperCase()
        if (q2) {
          const ea = a.base.toUpperCase() === q2 ? 2 : a.base.toUpperCase().startsWith(q2) ? 1 : 0
          const eb = b.base.toUpperCase() === q2 ? 2 : b.base.toUpperCase().startsWith(q2) ? 1 : 0
          if (ea !== eb) return eb - ea
        }
        return (b.volume24h ?? 0) - (a.volume24h ?? 0)
      })
      .slice(0, 200)
  }, [markets, exchange, group, query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const pick = (m: Market) => {
    onChange(m)
    setOpen(false)
  }

  // 筛选条件变化时把光标拨回第一项（在变更处直接处理，避免 effect 里 setState）
  const resetCursor = () => setCursor(0)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const m = filtered[cursor]
      if (m) pick(m)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group flex w-full items-center gap-3 rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--panel))] px-3 py-2.5 text-left transition-colors hover:border-[rgb(var(--accent)/0.45)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--accent-soft))] font-mono text-[13px] font-semibold text-[rgb(var(--accent))]">
          {value.base.slice(0, 3)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold">{value.base}</span>
            <span className="shrink-0 text-[11px] font-medium text-[rgb(var(--muted))]">
              {value.type === 'perp' ? '永续' : '交割'}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-[rgb(var(--muted))]">
            <span className="capitalize">{value.exchange}</span>
            <span className="text-[rgb(var(--faint))]">·</span>
            <span>{groupLabel(value.group)}</span>
            <span className="text-[rgb(var(--faint))]">·</span>
            <span className="tabular">{value.id}</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-[13px] font-semibold">
            {fmtPrice(marks.get(value.id) ?? value.lastPrice ?? 0)}
          </span>
          <span className="tabular block text-[10.5px] text-[rgb(var(--muted))]">
            最高 {value.maxLeverage}×
          </span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          className="shrink-0 text-[rgb(var(--faint))] transition-transform group-hover:text-[rgb(var(--fg-dim))]"
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--panel))] shadow-[0_18px_48px_-12px_rgb(var(--shadow)/0.32)]">
          <div className="space-y-2 border-b border-[rgb(var(--line-soft))] p-2.5">
            <div className="relative">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--faint))]"
              >
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  resetCursor()
                }}
                onKeyDown={onKeyDown}
                placeholder="搜索币种，如 BTC / ETH / SOL"
                className="w-full rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel-2))] py-1.5 pl-8 pr-2 text-[13px] outline-none placeholder:text-[rgb(var(--faint))] focus:border-[rgb(var(--accent)/0.55)]"
              />
            </div>
            <div className="-mx-0.5 flex flex-wrap items-center gap-1">
              {EXCHANGES.map((x) => (
                <Chip
                  key={x.id}
                  active={exchange === x.id}
                  onClick={() => {
                    setExchange(x.id)
                    resetCursor()
                  }}
                  label={x.label}
                />
              ))}
              <span className="mx-0.5 h-4 w-px bg-[rgb(var(--line))]" />
              {GROUPS.map((x) => (
                <Chip
                  key={x.id}
                  active={group === x.id}
                  onClick={() => {
                    setGroup(x.id)
                    resetCursor()
                  }}
                  label={x.label}
                />
              ))}
            </div>
          </div>

          <div ref={listRef} className="max-h-[330px] overflow-y-auto overscroll-contain p-1">
            {filtered.length === 0 && (
              <p className="px-3 py-8 text-center text-[12.5px] text-[rgb(var(--muted))]">
                没有匹配的合约
              </p>
            )}
            {filtered.map((m, i) => {
              const active = m.id === value.id
              const price = marks.get(m.id) ?? m.lastPrice ?? 0
              return (
                <button
                  key={`${m.exchange}-${m.id}`}
                  data-idx={i}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(m)}
                  className={[
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                    i === cursor ? 'bg-[rgb(var(--panel-2))]' : '',
                    active ? 'ring-1 ring-inset ring-[rgb(var(--accent)/0.5)]' : '',
                  ].join(' ')}
                >
                  <span className="w-[74px] shrink-0 truncate text-[12.5px] font-semibold">
                    {m.base}
                  </span>
                  <span className="w-[52px] shrink-0">
                    <Tag>{m.exchange === 'binance' ? 'BN' : 'OKX'}</Tag>
                  </span>
                  <span className="w-[62px] shrink-0 text-[11px] text-[rgb(var(--muted))]">
                    {groupLabel(m.group)}
                  </span>
                  <span className="tabular w-[70px] shrink-0 text-right text-[11.5px] text-[rgb(var(--fg-dim))]">
                    {fmtCompact(m.volume24h)}
                  </span>
                  <span className="tabular w-[52px] shrink-0 text-right text-[11px] text-[rgb(var(--muted))]">
                    {m.maxLeverage}×
                  </span>
                  <span className="tabular min-w-0 flex-1 truncate text-right text-[11.5px] text-[rgb(var(--fg-dim))]">
                    {fmtPrice(price)}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-between border-t border-[rgb(var(--line-soft))] px-3 py-1.5 text-[10.5px] text-[rgb(var(--muted))]">
            <span>{filtered.length} 个合约 · 按 24h 成交额排序</span>
            <span className="hidden sm:inline">↑↓ 选择 · Enter 确认 · Esc 关闭</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-[rgb(var(--fg)/0.08)] text-[rgb(var(--fg))]'
          : 'text-[rgb(var(--muted))] hover:text-[rgb(var(--fg-dim))]',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span className="inline-block rounded border border-[rgb(var(--line))] px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
      {children}
    </span>
  )
}
