import type { CalcResult, Market, Side } from '../lib/types'
import { fmtAmount, fmtMoney, fmtPct, fmtPrice, fmtSigned, fmtSignedPct } from '../lib/format'

interface Props {
  result: CalcResult
  market: Market
  side: Side
  entry: number
  leverage: number
}

/** 顶部 KPI 横条：一眼看到收益、收益率、保证金、强平 */
export function KpiStrip({ result, market, entry, leverage }: Props) {
  const profit = result.pnlNet >= 0
  const unit = result.unit
  const isInverse = market.contract === 'inverse'
  const qtyUnit = market.exchange === 'okx' || isInverse ? '张' : market.base

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[rgb(var(--line))] sm:grid-cols-4">
      <Cell label="预计净收益" accent={profit ? 'up' : 'down'}>
        <span className="tabular text-[17px] font-semibold leading-none">
          {fmtSigned(result.pnlNet)}
        </span>{' '}
        <span className="text-[10.5px] font-medium text-[rgb(var(--muted))]">{unit}</span>
      </Cell>
      <Cell label="收益率" accent={profit ? 'up' : 'down'}>
        <span className="tabular text-[17px] font-semibold leading-none">
          {fmtSignedPct(result.roiNet)}
        </span>{' '}
        <span className="tabular text-[10px] text-[rgb(var(--faint))]">
          毛 {fmtSignedPct(result.roiGross)}
        </span>
      </Cell>
      <Cell label="开仓保证金">
        <span className="tabular text-[17px] font-semibold leading-none">
          {fmtAmount(result.margin)}
        </span>{' '}
        <span className="text-[10.5px] font-medium text-[rgb(var(--muted))]">{unit}</span>
        <span className="tabular mt-1 block text-[10px] text-[rgb(var(--faint))]">
          {leverage}× · 名义 {fmtMoney(result.notional)} USD
        </span>
      </Cell>
      <Cell label="强平价格" accent={result.noLiquidation ? undefined : 'down'}>
        <span className="tabular text-[17px] font-semibold leading-none">
          {result.noLiquidation ? '—' : fmtPrice(result.liqPrice)}
        </span>
        <span className="tabular mt-1 block text-[10px] text-[rgb(var(--faint))]">
          {result.noLiquidation
            ? '价格归零前不会强平'
            : `距开仓 ${fmtPct(Math.abs(result.liqDistancePct), 2)} ${result.liqDistancePct < 0 ? '下方' : '上方'}`}
        </span>
      </Cell>
      <Cell label="开仓数量">
        <span className="tabular text-[15px] font-semibold leading-none">
          {fmtAmount(result.qty, 6)}
        </span>{' '}
        <span className="text-[10.5px] font-medium text-[rgb(var(--muted))]">{qtyUnit}</span>
        <span className="tabular mt-1 block text-[10px] text-[rgb(var(--faint))]">
          ≈ {fmtAmount(result.qtyBase, 6)} {market.base}
        </span>
      </Cell>
      <Cell label="保本价格">
        <span className="tabular text-[15px] font-semibold leading-none">{fmtPrice(result.breakEven)}</span>
        <span className="tabular mt-1 block text-[10px] text-[rgb(var(--faint))]">含双边手续费</span>
      </Cell>
      <Cell label="维持保证金率" span={2}>
        <span className="tabular text-[15px] font-semibold leading-none">{fmtPct(result.mmr, 3)}</span>
        <span className="tabular mt-1 block text-[10px] text-[rgb(var(--faint))]">
          第 {result.tierIndex + 1}/{result.tierCount} 档 · {fmtAmount(result.maintenanceMargin, 4)}{' '}
          {unit} · 可用 ≤{result.effectiveMaxLeverage}× · 开仓 {fmtMoney(entry)} USD
        </span>
      </Cell>
    </div>
  )
}

/** 明细：手续费 + 风险参数 + 提示 */
export function DetailGrid({ result, market }: Props) {
  const unit = result.unit
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="text-[11px] font-medium text-[rgb(var(--muted))]">手续费明细</p>
          <span className="tabular text-[11px] font-semibold">
            合计 {fmtAmount(result.fees.total, 4)} {unit}
          </span>
        </div>
        <div className="grid grid-cols-[46px_1fr_1fr] gap-x-2 text-[10.5px]">
          <span className="text-[rgb(var(--faint))]" />
          <span className="text-right text-[rgb(var(--faint))]">挂单 maker</span>
          <span className="text-right text-[rgb(var(--faint))]">吃单 taker</span>
          <span className="text-[rgb(var(--fg-dim))]">开仓</span>
          <span className="tabular text-right">{fmtAmount(result.fees.entryMaker, 4)}</span>
          <span className="tabular text-right">{fmtAmount(result.fees.entryTaker, 4)}</span>
          <span className="text-[rgb(var(--fg-dim))]">平仓</span>
          <span className="tabular text-right">{fmtAmount(result.fees.exitMaker, 4)}</span>
          <span className="tabular text-right">{fmtAmount(result.fees.exitTaker, 4)}</span>
        </div>
        <p className="mt-1.5 border-t border-[rgb(var(--line-soft))] pt-1 text-[9.5px] leading-snug text-[rgb(var(--faint))]">
          单位 {unit}；当前按
          {result.fees.openFee === result.fees.entryMaker ? ' maker ' : ' taker '}
          计入净收益。
        </p>
      </div>

      <div className="rounded-lg border border-[rgb(var(--line))] bg-[rgb(var(--panel))] p-2.5">
        <p className="mb-1.5 text-[11px] font-medium text-[rgb(var(--muted))]">风险参数</p>
        <dl className="space-y-1 text-[10.5px]">
          <Row label="维持保证金率" value={fmtPct(result.mmr, 3)} />
          <Row label="维持保证金" value={`${fmtAmount(result.maintenanceMargin, 4)} ${unit}`} />
          {market.liquidationFee ? (
            <Row
              label="强平手续费"
              value={`${fmtAmount(result.liqFee, 4)} ${unit}`}
              hint={`${fmtPct(market.liquidationFee, 2)}`}
            />
          ) : null}
          <Row label="档位上限杠杆" value={`≤ ${result.effectiveMaxLeverage}×`} />
        </dl>
      </div>
    </div>
  )
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <ul className="space-y-1 rounded-lg border border-[rgb(var(--warn)/0.32)] bg-[rgb(var(--warn-soft))] px-2.5 py-1.5">
      {warnings.map((w) => (
        <li key={w} className="flex gap-1.5 text-[10.5px] leading-snug text-[rgb(var(--warn))]">
          <span aria-hidden>▲</span>
          <span>{w}</span>
        </li>
      ))}
    </ul>
  )
}

function Cell({
  label,
  children,
  accent,
  span,
}: {
  label: string
  children: React.ReactNode
  accent?: 'up' | 'down'
  span?: 1 | 2
}) {
  const color =
    accent === 'up'
      ? 'text-[rgb(var(--up))]'
      : accent === 'down'
        ? 'text-[rgb(var(--down))]'
        : 'text-[rgb(var(--fg))]'
  return (
    <div
      className={[
        'bg-[rgb(var(--panel))] px-2.5 py-2',
        span === 2 ? 'col-span-2' : '',
      ].join(' ')}
    >
      <p className="text-[10px] font-medium text-[rgb(var(--muted))]">{label}</p>
      <p className={['mt-1', color].join(' ')}>{children}</p>
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[rgb(var(--muted))]">
        {label}
        {hint && <span className="ml-1 text-[9px] text-[rgb(var(--faint))]">{hint}</span>}
      </dt>
      <dd className="tabular font-medium text-[rgb(var(--fg-dim))]">{value}</dd>
    </div>
  )
}
