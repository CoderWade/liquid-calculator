import type { Market, RiskTier } from '../lib/types'
import { fmtCompact, fmtPct } from '../lib/format'

interface Props {
  market: Market
  tiers: RiskTier[]
  activeIndex: number
  /** 当前仓位在档位体系里的数值（USD 名义 / 币 / 张） */
  positionValue: number
}

export function TierTable({ market, tiers, activeIndex, positionValue }: Props) {
  if (!tiers.length) {
    return (
      <p className="rounded-lg border border-dashed border-[rgb(var(--line))] px-3 py-8 text-center text-[11.5px] leading-relaxed text-[rgb(var(--muted))]">
        该合约暂无档位快照数据。
        <br />
        <span className="text-[rgb(var(--faint))]">
          每日抓取覆盖成交额头部合约；OKX 其余合约会在选中时实时补抓。
        </span>
      </p>
    )
  }

  const unitLabel =
    tiers[0].unit === 'contracts' ? '张' : tiers[0].unit === 'coin' ? market.margin : market.quote
  return (
    <div>
      <div className="grid grid-cols-[26px_minmax(0,1fr)_54px_46px] gap-x-2 border-b border-[rgb(var(--line))] pb-1 text-[10px] font-medium text-[rgb(var(--muted))]">
        <span>#</span>
        <span>{tiers[0].unit === 'contracts' ? `张数区间` : `名义区间 ${unitLabel}`}</span>
        <span className="text-right">MMR</span>
        <span className="text-right">杠杆</span>
      </div>
      <div className="max-h-[178px] overflow-y-auto overscroll-contain">
        {tiers.map((t, i) => {
          const active = i === activeIndex
          return (
            <div
              key={`${t.floor}-${t.cap}`}
              className={[
                'relative grid grid-cols-[26px_minmax(0,1fr)_54px_46px] items-center gap-x-2 py-[3px] text-[11px] tabular',
                active ? 'bg-[rgb(var(--accent-soft))]' : '',
              ].join(' ')}
            >
              <span
                className={[
                  'flex items-center gap-1 pl-0.5 text-[10px]',
                  active ? 'font-semibold text-[rgb(var(--accent))]' : 'text-[rgb(var(--faint))]',
                ].join(' ')}
              >
                {active && (
                  <span
                    aria-hidden
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[rgb(var(--accent))]"
                  />
                )}
                {i + 1}
              </span>
              <span className="truncate text-[rgb(var(--fg-dim))]">
                {fmtCompact(t.floor)} – {fmtCompact(t.cap)}
              </span>
              <span className="text-right text-[rgb(var(--fg-dim))]">{fmtPct(t.mmr, 2)}</span>
              <span className={active ? 'text-right font-semibold' : 'text-right text-[rgb(var(--muted))]'}>
                {t.maxLeverage}×
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-1.5 border-t border-[rgb(var(--line-soft))] pt-1.5 text-[10px] text-[rgb(var(--faint))]">
        当前仓位 {fmtCompact(positionValue)} {unitLabel} · 匹配第 {activeIndex + 1} 档
        {tiers[0].unit === 'coin' ? '（币本位档位以币计）' : ''}
      </p>
    </div>
  )
}
