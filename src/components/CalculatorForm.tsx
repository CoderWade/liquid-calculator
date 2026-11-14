import { useEffect, useMemo, useRef, useState } from 'react'
import type { CalcResult, Market, Side } from '../lib/types'
import {
  decimalsForStep,
  fmtAmount,
  fmtPct,
  fmtPrice,
  roundToStep,
  trimPrice,
} from '../lib/format'

export interface FormState {
  side: Side
  leverage: number
  entry: string
  exit: string
  qty: string
  feeMode: 'maker' | 'taker'
  makerFeePct: string
  takerFeePct: string
}

interface Props {
  market: Market
  form: FormState
  setForm: (patch: Partial<FormState>) => void
  result: CalcResult | null
  livePrice: number | null
  liveAt: number | null
  onReset: () => void
}

const LEVERAGE_STEPS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125, 150]

export function CalculatorForm({
  market,
  form,
  setForm,
  result,
  livePrice,
  liveAt,
  onReset,
}: Props) {
  const [manualEntry, setManualEntry] = useState(false)
  const lastMarket = useRef(market.id)

  // 切换合约时用最新价格重填开仓价（用户手动改过则保留）
  useEffect(() => {
    if (lastMarket.current === market.id) return
    lastMarket.current = market.id
    if (!manualEntry) {
      const p = livePrice ?? market.lastPrice ?? 0
      if (p > 0) setForm({ entry: trimPrice(p, market), exit: trimPrice(p * 1.02, market) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.id, livePrice])

  const qtyUnit = market.exchange === 'okx' || market.contract === 'inverse' ? '张' : market.base
  const qtyDecimals = decimalsForStep(market.qtyStep)
  const maxLev = Math.max(1, Math.floor(market.maxLeverage || 1))
  const leverage = Math.min(Math.max(form.leverage, 1), maxLev)

  const notionalPreview = useMemo(() => {
    const q = Number(form.qty)
    const p = Number(form.entry)
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return 0
    return market.contract === 'inverse' ? q * market.contractSize : q * market.contractSize * p
  }, [form.qty, form.entry, market])

  const marginPreview = notionalPreview / Math.max(leverage, 1)

  const setLeverage = (v: number) => {
    setForm({ leverage: Math.min(Math.max(Math.round(v), 1), maxLev) })
  }

  const fillQtyByMargin = (usd: number) => {
    const p = Number(form.entry)
    if (!Number.isFinite(p) || p <= 0) return
    const notional = usd * leverage
    const raw =
      market.contract === 'inverse'
        ? notional / market.contractSize
        : notional / (market.contractSize * p)
    setForm({ qty: String(roundToStep(raw, market.qtyStep) || market.qtyStep) })
  }

  return (
    <div className="space-y-4">
      {/* 方向 */}
      <div>
        <Label>方向</Label>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(['long', 'short'] as const).map((s) => {
            const active = form.side === s
            const isLong = s === 'long'
            return (
              <button
                key={s}
                type="button"
                onClick={() => setForm({ side: s })}
                className={[
                  'rounded-lg border py-2 text-[13px] font-semibold transition-colors',
                  active
                    ? isLong
                      ? 'border-[rgb(var(--up)/0.5)] bg-[rgb(var(--up-soft))] text-[rgb(var(--up))]'
                      : 'border-[rgb(var(--down)/0.5)] bg-[rgb(var(--down-soft))] text-[rgb(var(--down))]'
                    : 'border-[rgb(var(--line))] text-[rgb(var(--muted))] hover:text-[rgb(var(--fg-dim))]',
                ].join(' ')}
              >
                {isLong ? '做多 Long' : '做空 Short'}
              </button>
            )
          })}
        </div>
      </div>

      {/* 价格 */}
      <div className="grid grid-cols-2 gap-2.5">
        <Field
          label="开仓价格"
          ariaLabel="开仓价格输入"
          value={form.entry}
          onChange={(v) => {
            setManualEntry(true)
            setForm({ entry: v })
          }}
          suffix={market.quote}
          hint={
            livePrice
              ? `实时 ${fmtPrice(livePrice)}${liveAt ? ` · ${new Date(liveAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}`
              : market.lastPrice
                ? `快照 ${fmtPrice(market.lastPrice)}`
                : undefined
          }
          onUseLive={livePrice ? () => setForm({ entry: trimPrice(livePrice, market) }) : undefined}
        />
        <Field
          label="平仓价格"
          ariaLabel="平仓价格输入"
          value={form.exit}
          onChange={(v) => setForm({ exit: v })}
          suffix={market.quote}
          hint={
            <div className="flex gap-1">
              {[-0.1, -0.05, 0, 0.05, 0.1].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const base = Number(form.entry)
                    if (Number.isFinite(base) && base > 0)
                      setForm({ exit: trimPrice(base * (1 + r), market) })
                  }}
                  className="rounded border border-[rgb(var(--line))] px-1 text-[9.5px] text-[rgb(var(--muted))] hover:border-[rgb(var(--accent)/0.5)] hover:text-[rgb(var(--fg-dim))]"
                >
                  {r === 0 ? '持平' : `${r > 0 ? '+' : ''}${(r * 100).toFixed(0)}%`}
                </button>
              ))}
            </div>
          }
        />
      </div>

      {/* 杠杆 */}
      <div>
        <div className="flex items-baseline justify-between">
          <Label>杠杆</Label>
          <span className="tabular text-[11px] text-[rgb(var(--muted))]">
            最高 {maxLev}×
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={maxLev}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            aria-label="杠杆倍率"
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[rgb(var(--line))] accent-[rgb(var(--accent))]"
            style={{
              background: `linear-gradient(to right, rgb(var(--accent)) ${((leverage - 1) / Math.max(maxLev - 1, 1)) * 100}%, rgb(var(--line)) ${((leverage - 1) / Math.max(maxLev - 1, 1)) * 100}%)`,
            }}
          />
          <div className="flex items-center rounded-md border border-[rgb(var(--line))] bg-[rgb(var(--panel))]">
            <input
              type="number"
              value={form.leverage}
              min={1}
              max={maxLev}
              onChange={(e) => setForm({ leverage: Number(e.target.value) || 1 })}
              onBlur={() => setLeverage(form.leverage)}
              className="tabular w-11 bg-transparent py-1 pl-2 text-right text-[12px] font-semibold outline-none"
              aria-label="杠杆数值"
            />
            <span className="pr-2 text-[11px] text-[rgb(var(--muted))]">×</span>
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-6 gap-1">
          {LEVERAGE_STEPS.filter((l) => l <= maxLev).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLeverage(l)}
              className={[
                'tabular rounded py-1 text-[10.5px] font-medium transition-colors',
                leverage === l
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--accent-fg))]'
                  : 'bg-[rgb(var(--panel-2))] text-[rgb(var(--muted))] hover:text-[rgb(var(--fg-dim))]',
              ].join(' ')}
            >
              {l}×
            </button>
          ))}
        </div>
      </div>

      {/* 数量 */}
      <div>
        <div className="flex items-baseline justify-between">
          <Label>开仓数量</Label>
          <span className="tabular text-[10.5px] text-[rgb(var(--faint))]">
            最小 {fmtAmount(market.qtyStep, qtyDecimals)} {qtyUnit} · 步长同上
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel))] px-2.5 py-1.5 focus-within:border-[rgb(var(--accent)/0.55)]">
          <input
            value={form.qty}
            onChange={(e) => setForm({ qty: e.target.value.replace(/[^\d.]/g, '') })}
            onBlur={() => {
              const q = Number(form.qty)
              if (!Number.isFinite(q) || q <= 0) return
              const snapped = Math.max(roundToStep(q, market.qtyStep), market.minQty)
              setForm({ qty: String(snapped) })
            }}
            inputMode="decimal"
            placeholder="0"
            className="tabular min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-[rgb(var(--faint))]"
            aria-label={`开仓数量（${qtyUnit}）`}
          />
          <span className="shrink-0 text-[12px] font-medium text-[rgb(var(--muted))]">{qtyUnit}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {[100, 500, 1000, 5000].map((usd) => (
            <button
              key={usd}
              type="button"
              onClick={() => fillQtyByMargin(usd)}
              title={`按保证金 ${usd} 计算数量`}
              className="tabular rounded border border-[rgb(var(--line))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted))] hover:border-[rgb(var(--accent)/0.5)] hover:text-[rgb(var(--fg-dim))]"
            >
              {usd}
            </button>
          ))}
          <span className="ml-auto tabular whitespace-nowrap text-[10px] text-[rgb(var(--faint))]">
            名义 {fmtAmount(notionalPreview)} · 保证金 {fmtAmount(marginPreview)}
          </span>
        </div>
      </div>

      {/* 费率 */}
      <div>
        <div className="flex items-baseline justify-between">
          <Label>手续费模式</Label>
          <div className="flex gap-0.5 rounded-md bg-[rgb(var(--panel-2))] p-0.5 ring-1 ring-[rgb(var(--line))]">
            {(['maker', 'taker'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm({ feeMode: m })}
                className={[
                  'rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                  form.feeMode === m
                    ? 'bg-[rgb(var(--panel))] text-[rgb(var(--fg))] shadow-[0_1px_2px_rgb(var(--shadow)/0.1)]'
                    : 'text-[rgb(var(--muted))]',
                ].join(' ')}
              >
                {m === 'maker' ? '挂单' : '吃单'}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <RateInput
            label="挂单费率"
            value={form.makerFeePct}
            onChange={(v) => setForm({ makerFeePct: v })}
            active={form.feeMode === 'maker'}
          />
          <RateInput
            label="吃单费率"
            value={form.takerFeePct}
            onChange={(v) => setForm({ takerFeePct: v })}
            active={form.feeMode === 'taker'}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[rgb(var(--line-soft))] pt-3">
        <button
          type="button"
          onClick={onReset}
          className="text-[11.5px] font-medium text-[rgb(var(--muted))] hover:text-[rgb(var(--fg-dim))]"
        >
          重置为实时价
        </button>
        {result && (
          <span className="tabular text-[10.5px] text-[rgb(var(--faint))]">
            {result.tierCount > 0
              ? `第 ${result.tierIndex + 1}/${result.tierCount} 档 · MMR ${fmtPct(result.mmr, 2)}`
              : '无档位数据'}
          </span>
        )}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11.5px] font-medium text-[rgb(var(--muted))]">{children}</span>
}

function Field({
  label,
  ariaLabel,
  value,
  onChange,
  suffix,
  hint,
  onUseLive,
}: {
  label: string
  ariaLabel: string
  value: string
  onChange: (v: string) => void
  suffix?: string
  hint?: React.ReactNode
  onUseLive?: () => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {onUseLive && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              onUseLive()
            }}
            className="text-[10px] font-medium text-[rgb(var(--accent))] hover:underline"
          >
            用实时价
          </button>
        )}
      </span>
      <span className="mt-1.5 flex items-center gap-1 rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel))] px-2.5 py-1.5 focus-within:border-[rgb(var(--accent)/0.55)]">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal"
          placeholder="0"
          aria-label={ariaLabel}
          className="tabular min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none placeholder:text-[rgb(var(--faint))]"
        />
        {suffix && (
          <span className="shrink-0 text-[10.5px] font-medium text-[rgb(var(--muted))]">{suffix}</span>
        )}
      </span>
      {hint && (
        <span className="mt-1 block text-[10px] leading-tight text-[rgb(var(--faint))]">{hint}</span>
      )}
    </label>
  )
}

function RateInput({
  label,
  value,
  onChange,
  active,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  active: boolean
}) {
  return (
    <label
      className={[
        'flex items-center gap-1 rounded-lg border px-2 py-1.5',
        active
          ? 'border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent-soft))]'
          : 'border-[rgb(var(--line))] bg-[rgb(var(--panel))]',
      ].join(' ')}
    >
      <span className="shrink-0 text-[10px] text-[rgb(var(--muted))]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        inputMode="decimal"
        className="tabular min-w-0 flex-1 bg-transparent text-right text-[12px] font-semibold outline-none"
        aria-label={`${label}（%）`}
      />
      <span className="text-[10px] text-[rgb(var(--muted))]">%</span>
    </label>
  )
}
