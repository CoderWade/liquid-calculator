import { useMemo } from 'react'
import type { CalcResult, Market, Side } from '../lib/types'
import { fmtPrice } from '../lib/format'

interface Props {
  result: CalcResult
  market: Market
  side: Side
  entry: number
  exit: number
}

const W = 760
const H = 232
const PAD_T = 30
const PAD_B = 26
const PAD_L = 10
const PAD_R = 14

/**
 * 价格 → 权益 / 维持保证金曲线，交点即强平价。
 * 数值单位统一为「保证金币」（linear: USDT/USDC，inverse: 标的币）。
 */
export function LiqChart({ result, market, side, entry, exit }: Props) {
  const geo = useMemo(() => {
    const pts = result.curve
    if (pts.length < 2) return null

    const prices = pts.map((p) => p.price)
    const xMin = Math.min(...prices)
    const xMax = Math.max(...prices)

    // y 轴裁掉过深的负值区，避免曲线被压成一条线
    const equities = pts.map((p) => p.equity)
    let yMin = Math.min(0, ...equities)
    let yMax = Math.max(0, ...equities, ...pts.map((p) => p.mm))
    const realMin = Math.min(...equities)
    if (realMin < yMin) yMin = Math.max(realMin, -(yMax - yMin) * 0.42)

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax - yMin < 1e-9) {
      yMin = -1
      yMax = 1
    }
    const pad = (yMax - yMin) * 0.1
    yMin -= pad
    yMax += pad

    const plotW = W - PAD_L - PAD_R
    const plotH = H - PAD_T - PAD_B
    const x = (p: number) => PAD_L + ((p - xMin) / (xMax - xMin || 1)) * plotW
    const y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH

    const line = (key: 'equity' | 'mm') =>
      pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.price).toFixed(2)},${y(p[key]).toFixed(2)}`)
        .join(' ')

    return {
      x,
      y,
      xMin,
      xMax,
      equityPath: line('equity'),
      mmPath: line('mm'),
      baseY: y(0),
      entryX: x(entry),
      exitX: x(exit),
      liqX: result.noLiquidation || !result.liqPrice ? null : x(result.liqPrice),
      plotLeft: PAD_L,
      plotRight: W - PAD_R,
    }
  }, [result, entry, exit])

  if (!geo) return null

  const { x, y, xMin, xMax, equityPath, mmPath, baseY, entryX, exitX, liqX, plotLeft, plotRight } =
    geo
  const liqLabel = result.noLiquidation ? '无强平价' : fmtPrice(result.liqPrice)
  const profit = result.pnlNet >= 0
  const lineColor = profit ? 'rgb(var(--up))' : 'rgb(var(--down))'

  const areaPath = `${equityPath} L${x(xMax).toFixed(2)},${baseY.toFixed(2)} L${x(xMin).toFixed(2)},${baseY.toFixed(2)} Z`
  // 两条竖线靠得太近时，标签上下错开，避免叠字
  const labels: Array<{
    px: number
    text: string
    color: string
    anchor: 'start' | 'middle' | 'end'
    row: 0 | 1
  }> = []
  const clampAnchor = (px: number) =>
    px < plotLeft + 56 ? 'start' : px > plotRight - 56 ? 'end' : ('middle' as const)
  const near = liqX !== null && Math.abs(liqX - entryX) < 92

  if (entryX >= plotLeft && entryX <= plotRight) {
    labels.push({
      px: entryX,
      text: `开仓 ${fmtPrice(entry)}`,
      color: 'rgb(var(--muted))',
      anchor: clampAnchor(entryX),
      row: near ? 1 : 0,
    })
  }
  if (liqX !== null && liqX >= plotLeft && liqX <= plotRight) {
    labels.push({
      px: liqX,
      text: `强平 ${liqLabel}`,
      color: 'rgb(var(--down))',
      anchor: clampAnchor(liqX),
      row: 0,
    })
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-[rgb(var(--fg-dim))]">价格 · 权益曲线</h3>
        <div className="flex items-center gap-3 text-[10px] text-[rgb(var(--muted))]">
          <Legend color={lineColor}>权益</Legend>
          <Legend color="rgb(var(--down))" dashed>
            维持保证金
          </Legend>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        preserveAspectRatio="none"
        style={{ height: 232 }}
        role="img"
        aria-label={`强平价格 ${liqLabel}，权益曲线与维持保证金曲线交点`}
      >
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={profit ? 'rgb(var(--up))' : 'rgb(var(--down))'} stopOpacity="0.15" />
            <stop offset="100%" stopColor={profit ? 'rgb(var(--up))' : 'rgb(var(--down))'} stopOpacity="0" />
          </linearGradient>
          <clipPath id="plotClip">
            <rect x={plotLeft} y={PAD_T} width={plotRight - plotLeft} height={H - PAD_T - PAD_B} />
          </clipPath>
        </defs>

        <line
          x1={plotLeft}
          x2={plotRight}
          y1={baseY}
          y2={baseY}
          stroke="rgb(var(--fg)/0.16)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        <g clipPath="url(#plotClip)">
          <path d={areaPath} fill="url(#eqFill)" />
          <path d={mmPath} fill="none" stroke="rgb(var(--down))" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.8" />
          <path d={equityPath} fill="none" stroke={lineColor} strokeWidth="1.9" strokeLinejoin="round" />
          {entryX >= plotLeft && entryX <= plotRight && (
            <line
              x1={entryX}
              x2={entryX}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="rgb(var(--fg)/0.26)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />
          )}
          {exitX >= plotLeft && exitX <= plotRight && exitX !== entryX && (
            <line
              x1={exitX}
              x2={exitX}
              y1={PAD_T}
              y2={H - PAD_B}
              stroke="rgb(var(--accent)/0.55)"
              strokeWidth="1"
            />
          )}
          {liqX !== null && liqX >= plotLeft && liqX <= plotRight && (
            <>
              <line x1={liqX} x2={liqX} y1={PAD_T} y2={H - PAD_B} stroke="rgb(var(--down))" strokeWidth="1.3" />
              <circle cx={liqX} cy={y(result.curve[0].mm > 0 ? geo.y(0) : 0)} r="0" />
            </>
          )}
        </g>

        <line x1={plotLeft} x2={plotRight} y1={H - PAD_B} y2={H - PAD_B} stroke="rgb(var(--line))" strokeWidth="1" />

        {labels.map((l) => (
          <text
            key={l.text}
            x={l.px}
            y={l.row === 0 ? 13 : 25}
            textAnchor={l.anchor}
            fontSize="10"
            fill={l.color}
            fontWeight="600"
            className="tabular"
          >
            {l.text}
          </text>
        ))}

        <text x={plotLeft} y={H - 9} fontSize="9.5" fill="rgb(var(--faint))" className="tabular">
          {fmtPrice(xMin)}
        </text>
        <text
          x={plotRight}
          y={H - 9}
          textAnchor="end"
          fontSize="9.5"
          fill="rgb(var(--faint))"
          className="tabular"
        >
          {fmtPrice(xMax)}
        </text>
      </svg>

      <p className="mt-1 text-[10px] leading-relaxed text-[rgb(var(--faint))]">
        权益 = 初始保证金 − 开仓费 + 浮盈亏，与红色维持保证金线相交处即强平价，单位 {market.margin}；
        {side === 'long' ? '多单' : '空单'}按标记价格触发强平，实际可能因资金费率与档位变动而偏移。
      </p>
    </div>
  )
}

function Legend({
  color,
  children,
  dashed,
}: {
  color: string
  children: React.ReactNode
  dashed?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0 w-3.5"
        style={{ borderTop: `${dashed ? '1.5px dashed' : '2px solid'} ${color}` }}
      />
      {children}
    </span>
  )
}
