/** 展示层格式化：数字、价格、百分比、数量精度 */

export function fmtNum(v: number, maxFrac = 2, minFrac = 0): string {
  if (!Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: minFrac,
  })
}

/** 按数量级自动选精度，价格从 0.00001234 到 96000 都能读 */
export function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '—'
  const abs = Math.abs(v)
  let digits: number
  if (abs >= 10000) digits = 1
  else if (abs >= 1000) digits = 2
  else if (abs >= 1) digits = 4
  else if (abs >= 0.01) digits = 5
  else if (abs >= 0.0001) digits = 6
  else digits = 8
  return v.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })
}

/** 金额：大额加千分位，小额保留有效位 */
export function fmtAmount(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs !== 0 && abs < 0.01) {
    return v.toLocaleString('en-US', { maximumSignificantDigits: 4 })
  }
  return v.toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  })
}

/** 动态金额：保证精度不丢信息 */
export function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return fmtAmount(v, 0)
  if (abs >= 1000) return fmtAmount(v, 2)
  if (abs >= 1) return fmtAmount(v, 2)
  if (abs === 0) return '0.00'
  return v.toLocaleString('en-US', { maximumSignificantDigits: 4 })
}

export function fmtPct(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(decimals)}%`
}

export function fmtSignedPct(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '—'
  const s = (v * 100).toFixed(decimals)
  return `${v > 0 ? '+' : ''}${s}%`
}

export function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const s = fmtMoney(Math.abs(v))
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return v.toFixed(0)
}

/** 数量按 step 推导小数位，避免 0.001 下单显示成 1 */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const s = step.toString()
  if (s.includes('e-')) return Number(s.split('e-')[1])
  const dot = s.indexOf('.')
  return dot >= 0 ? s.length - dot - 1 : 0
}

export function roundToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value
  return Math.round(value / step) * step
}

export function groupLabel(group: string): string {
  return group === 'usdt' ? 'USDT 永续' : group === 'usdc' ? 'USDC 永续' : '币本位'
}

export function groupShort(group: string): string {
  return group === 'usdt' ? 'USDT' : group === 'usdc' ? 'USDⓈ' : 'COIN-M'
}

/** 价格按 tick 取整，避免出现 96523.4567 这种假精度 */
export function trimPrice(price: number, market: { priceTick: number }): string {
  const tick = market.priceTick || 0.0001
  const rounded = roundToStep(price, tick)
  const decimals = decimalsForStep(tick)
  return rounded.toFixed(Math.min(decimals, 8))
}
