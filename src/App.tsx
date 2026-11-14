import { useEffect, useMemo, useRef, useState } from 'react'
import { CalculatorForm, type FormState } from './components/CalculatorForm'
import { LiqChart } from './components/LiqChart'
import { MarketPicker } from './components/MarketPicker'
import { DetailGrid, KpiStrip, Warnings } from './components/ResultPanel'
import { TierTable } from './components/TierTable'
import { compute, notionalUsd, tierPositionValue } from './lib/calc'
import { fetchAllMarks, fetchQuote, loadIndex, tiersFor } from './lib/data'
import { fmtPct, fmtPrice, groupLabel, trimPrice } from './lib/format'
import type { CalcResult, Market, RiskTier } from './lib/types'

const DEFAULT_ID = 'BTCUSDT'
const EMPTY_TIERS: RiskTier[] = []

export default function App() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [meta, setMeta] = useState<{ generatedAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [market, setMarket] = useState<Market | null>(null)
  const [tierState, setTierState] = useState<{ id: string; tiers: RiskTier[] }>({
    id: '',
    tiers: [],
  })
  const [marks, setMarks] = useState<Map<string, number>>(new Map())
  const [quote, setQuote] = useState<{
    id: string
    price: number
    ts: number
    source: string
  } | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light',
  )

  const [form, setFormState] = useState<FormState>({
    side: 'long',
    leverage: 10,
    entry: '',
    exit: '',
    qty: '',
    feeMode: 'taker',
    makerFeePct: '0.02',
    takerFeePct: '0.05',
  })

  const setForm = (patch: Partial<FormState>) => setFormState((f) => ({ ...f, ...patch }))

  // 数据加载
  useEffect(() => {
    loadIndex()
      .then((idx) => {
        setMarkets(idx.markets)
        setMeta({ generatedAt: idx.generatedAt })
        const first = idx.markets.find((m) => m.id === DEFAULT_ID) ?? idx.markets[0]
        if (first) setMarket(first)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // 列表价格：全量拉一次，之后 30s 刷新
  useEffect(() => {
    if (!markets.length) return
    let cancelled = false
    const loadMarks = () => {
      fetchAllMarks().then((m) => {
        if (!cancelled && m.size) setMarks(m)
      })
    }
    loadMarks()
    const id = window.setInterval(loadMarks, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [markets.length])

  // 选中合约：档位 + 实时价（10s）
  useEffect(() => {
    if (!market) return
    let cancelled = false
    tiersFor(market).then((t) => {
      // 只接受当前合约的结果，切换后旧请求直接丢弃
      if (!cancelled) setTierState({ id: market.id, tiers: t })
    })

    const tick = () => {
      fetchQuote(market).then((q) => {
        if (!cancelled && q)
          setQuote({ id: market.id, price: q.price, ts: q.ts, source: q.source })
      })
    }
    tick()
    const id = window.setInterval(tick, 10_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [market])

  const live = quote && quote.id === market?.id ? quote : null

  // 首次拿到价格时填默认值
  const initedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!market) return
    const price = live?.price ?? market.lastPrice
    if (!price) return
    if (initedFor.current === market.id) return
    initedFor.current = market.id
    setFormState((f) => ({
      ...f,
      entry: trimPrice(price, market),
      exit: trimPrice(price * (f.side === 'long' ? 1.02 : 0.98), market),
      leverage: Math.min(f.leverage, Math.max(1, Math.floor(market.maxLeverage || 1))),
      makerFeePct: trimRate(market.makerFee),
      takerFeePct: trimRate(market.takerFee),
      qty: String(
        !f.qty || Number(f.qty) < market.minQty ? Math.max(market.minQty, market.qtyStep) : f.qty,
      ),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, live?.price])

  // 主题
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('lc-theme', theme)
    } catch {
      /* 隐私模式忽略 */
    }
  }, [theme])

  const tiers = tierState.id === market?.id ? tierState.tiers : EMPTY_TIERS
  const marketWithTiers = useMemo(
    () => (market ? { ...market, tiers } : null),
    [market, tiers],
  )

  const result: CalcResult | null = useMemo(() => {
    if (!marketWithTiers) return null
    const entry = Number(form.entry)
    const exit = Number(form.exit)
    const qty = Number(form.qty)
    if (!Number.isFinite(entry) || entry <= 0) return null
    if (!Number.isFinite(exit) || exit <= 0) return null
    if (!Number.isFinite(qty) || qty <= 0) return null
    return compute({
      market: marketWithTiers,
      side: form.side,
      leverage: form.leverage,
      entryPrice: entry,
      exitPrice: exit,
      qty,
      feeMode: form.feeMode,
      makerFee: (Number(form.makerFeePct) || 0) / 100,
      takerFee: (Number(form.takerFeePct) || 0) / 100,
    })
  }, [marketWithTiers, form])

  const positionValue = useMemo(() => {
    if (!marketWithTiers) return 0
    const entry = Number(form.entry)
    const qty = Number(form.qty)
    if (!Number.isFinite(entry) || !Number.isFinite(qty) || entry <= 0 || qty <= 0) return 0
    return tierPositionValue(marketWithTiers, qty, entry)
  }, [marketWithTiers, form.entry, form.qty])

  const notional = useMemo(() => {
    if (!marketWithTiers) return 0
    const entry = Number(form.entry)
    const qty = Number(form.qty)
    if (!Number.isFinite(entry) || !Number.isFinite(qty)) return 0
    return notionalUsd(marketWithTiers, qty, entry)
  }, [marketWithTiers, form.entry, form.qty])

  if (error) {
    return (
      <Shell>
        <div className="mx-auto mt-10 max-w-lg rounded-xl border border-[rgb(var(--down)/0.4)] bg-[rgb(var(--down-soft))] p-5 text-[13px] text-[rgb(var(--down))]">
          <p className="font-semibold">数据加载失败</p>
          <p className="mt-1 opacity-90">{error}</p>
          <p className="mt-2 text-[11.5px] opacity-80">
            本地请先运行 <code className="font-mono">npm run fetch-data</code> 生成 public/data。
          </p>
        </div>
      </Shell>
    )
  }

  if (!market) {
    return (
      <Shell>
        <div className="flex min-h-[50vh] items-center justify-center gap-2 text-[13px] text-[rgb(var(--muted))]">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[rgb(var(--line))] border-t-[rgb(var(--accent))]" />
          正在加载合约数据…
        </div>
      </Shell>
    )
  }

  return (
    <Shell onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} theme={theme}>
      <div className="mx-auto w-full max-w-[1280px] px-3 pb-8 pt-3 sm:px-5 lg:px-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,352px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,376px)_minmax(0,1fr)]">
          {/* 左：输入 */}
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-3">
              <MarketPicker markets={markets} value={market} marks={marks} onChange={setMarket} />
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Spec label="合约面值" value={`${market.contractSize} ${market.contractSizeCcy}`} />
                <Spec
                  label="最小下单"
                  value={`${market.minQty} ${market.exchange === 'okx' || market.contract === 'inverse' ? '张' : market.base}`}
                />
                <Spec label="24h 成交额" value={`$${fmtCompactish(market.volume24h)}`} />
              </div>
            </div>

            <div className="rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-3.5">
              <CalculatorForm
                market={marketWithTiers ?? market}
                form={form}
                setForm={setForm}
                result={result}
                livePrice={live?.price ?? null}
                liveAt={live?.ts ?? null}
                onReset={() => {
                  const p = live?.price ?? market.lastPrice
                  if (!p) return
                  setForm({
                    entry: trimPrice(p, market),
                    exit: trimPrice(p * (form.side === 'long' ? 1.02 : 0.98), market),
                  })
                }}
              />
            </div>
          </div>

          {/* 右：结果 */}
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">
                    {market.base} / {market.quote}
                  </span>
                  <span className="rounded border border-[rgb(var(--line))] px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                    {market.exchange === 'binance' ? 'Binance' : 'OKX'}
                  </span>
                  <span className="text-[10.5px] text-[rgb(var(--muted))]">
                    {groupLabel(market.group)} · {market.contract === 'inverse' ? '反向' : '线性'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10.5px] text-[rgb(var(--muted))]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className={[
                        'inline-flex h-1.5 w-1.5 rounded-full',
                        live ? 'bg-[rgb(var(--up))]' : 'bg-[rgb(var(--faint))]',
                      ].join(' ')}
                    />
                    {live && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(var(--up)/0.5)]" />
                    )}
                  </span>
                  <span className="tabular">
                    {live ? fmtPrice(live.price) : market.lastPrice ? fmtPrice(market.lastPrice) : '—'}{' '}
                    {market.quote}
                  </span>
                  <span className="text-[rgb(var(--faint))]">
                    {live ? (live.source === 'mark' ? '标记价' : '最新成交') : '快照价'}
                  </span>
                </div>
              </div>

              {result ? (
                <div className="space-y-2.5">
                  <KpiStrip
                    result={result}
                    market={marketWithTiers ?? market}
                    side={form.side}
                    entry={Number(form.entry)}
                    leverage={form.leverage}
                  />
                  <LiqChart
                    result={result}
                    market={marketWithTiers ?? market}
                    side={form.side}
                    entry={Number(form.entry)}
                    exit={Number(form.exit)}
                  />
                  <DetailGrid
                    result={result}
                    market={marketWithTiers ?? market}
                    side={form.side}
                    entry={Number(form.entry)}
                    leverage={form.leverage}
                  />
                  <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,240px)]">
                    <div className="rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-2.5">
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <h2 className="text-[11px] font-medium text-[rgb(var(--muted))]">风险档位</h2>
                        <span className="tabular text-[10px] text-[rgb(var(--faint))]">
                          名义 ${fmtCompactish(notional)} · 共 {tiers.length} 档
                        </span>
                      </div>
                      <TierTable
                        market={marketWithTiers ?? market}
                        tiers={tiers}
                        activeIndex={result.tierIndex}
                        positionValue={positionValue}
                      />
                    </div>
                    <FormulaNote market={marketWithTiers ?? market} result={result} />
                  </div>
                  <Warnings warnings={result.warnings} />
                </div>
              ) : (
                <p className="py-12 text-center text-[12.5px] text-[rgb(var(--muted))]">
                  填入开仓价、平仓价与数量后显示结果
                </p>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-[rgb(var(--faint))]">
              <span>
                数据快照{' '}
                {meta
                  ? new Date(meta.generatedAt).toLocaleString('zh-CN', { hour12: false })
                  : '—'}
                {' · '}费率取 VIP 0，实际以账户为准 · 强平按标记价格估算
              </span>
              <span className="tabular">v{__APP_VERSION__}</span>
            </footer>
          </div>
        </div>
      </div>
    </Shell>
  )
}

function FormulaNote({ market, result }: { market: Market; result: CalcResult }) {
  const inverse = market.contract === 'inverse'
  return (
    <div className="rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel-2))] p-2.5">
      <h2 className="mb-1.5 text-[11px] font-medium text-[rgb(var(--muted))]">计算口径</h2>
      <ul className="space-y-1.5 text-[9.5px] leading-relaxed text-[rgb(var(--faint))]">
        <li>
          <span className="text-[rgb(var(--fg-dim))]">保证金</span> ={' '}
          {inverse ? '张数 × 面值 ÷ 价格' : '数量 × 价格'} ÷ 杠杆
        </li>
        <li>
          <span className="text-[rgb(var(--fg-dim))]">维持保证金</span> = 名义 × MMR
          {market.tiers[0]?.unit === 'coin' ? '（以币计）' : ''}
        </li>
        <li>
          <span className="text-[rgb(var(--fg-dim))]">强平价</span> = 权益（保证金 − 开仓费 +
          浮盈亏）等于维持保证金时的价格，二分求解并按新价格重匹配档位
        </li>
        <li>
          <span className="text-[rgb(var(--fg-dim))]">手续费</span> = 名义 × 费率
          {inverse ? ' ÷ 价格（以币结算）' : ''}，挂/吃单分别计算
        </li>
        <li>强平按标记价格触发；档位 MMR 取 {fmtPct(result.mmr, 2)}</li>
      </ul>
    </div>
  )
}

function trimRate(rate: number): string {
  const pct = rate * 100
  return String(Number(pct.toFixed(4)))
}

function Shell({
  children,
  theme,
  onToggleTheme,
}: {
  children: React.ReactNode
  theme?: 'light' | 'dark'
  onToggleTheme?: () => void
}) {
  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-30 border-b border-[rgb(var(--line))] bg-[rgb(var(--bg)/0.84)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3 px-3 py-2 sm:px-5 lg:px-6">
          <div className="flex items-center gap-2">
            <Logo />
            <div>
              <h1 className="text-[13.5px] font-semibold leading-tight tracking-tight">
                合约强平计算器
              </h1>
              <p className="text-[10px] leading-tight text-[rgb(var(--muted))]">
                Binance · OKX — USDT / USDⓈ / 币本位
              </p>
            </div>
          </div>
          {onToggleTheme && theme && (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="切换主题"
              className="rounded-md border border-[rgb(var(--line))] p-1.5 text-[rgb(var(--muted))] transition-colors hover:text-[rgb(var(--fg))]"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function Logo() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[rgb(var(--accent))] text-[rgb(var(--accent-fg))]">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 17.5 9 11l4 4 8-9"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 5.5h6v6"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-[rgb(var(--panel-2))] px-1.5 py-1">
      <p className="text-[9.5px] text-[rgb(var(--faint))]">{label}</p>
      <p className="tabular mt-0.5 truncate text-[10.5px] font-medium text-[rgb(var(--fg-dim))]">
        {value}
      </p>
    </div>
  )
}

function fmtCompactish(v: number): string {
  if (!Number.isFinite(v) || !v) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  if (abs >= 1) return v.toFixed(2)
  if (abs >= 0.01) return v.toFixed(3)
  return v.toPrecision(3)
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
