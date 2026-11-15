/**
 * 合约损益 / 保证金 / 强平价格计算。
 *
 * 统一口径：
 *  - qty 是「下单单位」：Binance 线性=标的币数量，OKX=合约张数，反向合约=张数。
 *    Binance 一张线性合约 = contractSize 个标的（USDT 永续为 1）。
 *  - 盈亏 / 保证金 / 手续费都换算到「保证金币」(margin)：linear → USDT/USDC，
 *    inverse → 标的币（如 BTC）。
 *  - 强平价格 = 权益（初始保证金 − 开仓费 + 未实现盈亏）== 维持保证金 时的标记价格，
 *    用二分法求解；档位随名义价值变化会被重新匹配（跨档后 mmr 变大）。
 *  - 手续费不按档位打折，直接用用户输入的 maker/taker 费率。
 */
import type { CalcInput, CalcResult, FeeBreakdown, Market, RiskTier, Side } from './types'

const EPS = 1e-12

export function isInverse(market: Market): boolean {
  return market.contract === 'inverse'
}

/** 一张合约对应的标的币数量（反向合约与价格相关） */
export function basePerContract(market: Market, price: number): number {
  if (isInverse(market)) return market.contractSize / Math.max(price, EPS)
  return market.contractSize
}

/** 名义价值（USD） */
export function notionalUsd(market: Market, qty: number, price: number): number {
  if (isInverse(market)) return Math.abs(qty) * market.contractSize
  return Math.abs(qty) * market.contractSize * price
}

/** 标的币数量 */
export function baseQuantity(market: Market, qty: number, price: number): number {
  return Math.abs(qty) * basePerContract(market, price)
}

/**
 * 档位匹配依据：
 *  - Binance 线性 → 计价币名义（USD）
 *  - Binance 反向 → 保证金币名义（币），其档位表单位就是币
 *  - OKX → 合约张数
 */
export function tierPositionValue(market: Market, qty: number, price: number): number {
  if (market.exchange === 'okx') return Math.abs(qty)
  if (isInverse(market)) return (Math.abs(qty) * market.contractSize) / Math.max(price, EPS)
  return Math.abs(qty) * market.contractSize * price
}

export function pickTier(
  tiers: RiskTier[],
  market: Market,
  qty: number,
  price: number,
): { tier: RiskTier | null; index: number; x: number } {
  if (!tiers.length) return { tier: null, index: -1, x: 0 }
  const x = tierPositionValue(market, qty, price)
  let index = 0
  for (let i = 0; i < tiers.length; i++) {
    if (x >= tiers[i].floor - EPS) index = i
    else break
  }
  return { tier: tiers[index], index, x }
}

/** 维持保证金（保证金币计价） */
export function maintenanceMargin(
  tiers: RiskTier[],
  market: Market,
  qty: number,
  price: number,
): number {
  const { tier, x } = pickTier(tiers, market, qty, price)
  if (!tier) return 0
  if (tier.unit === 'contracts') {
    // OKX：tierPositionValue 是张数，名义按张数重算
    const notional = Math.abs(qty) * market.contractSize * (isInverse(market) ? 1 : price)
    const mm = notional * tier.mmr
    return isInverse(market) ? mm / Math.max(price, EPS) : mm
  }
  // Binance：mm = 档位名义 × mmr − cum（同币种）
  return Math.max(x * tier.mmr - tier.cum, x * tier.mmr * 0.5)
}

/** 未实现盈亏（保证金币计价） */
export function grossPnl(
  market: Market,
  side: Side,
  qty: number,
  entry: number,
  exit: number,
): number {
  const contracts = Math.abs(qty)
  if (isInverse(market)) {
    const v = contracts * market.contractSize
    return side === 'long' ? v * (1 / entry - 1 / exit) : v * (1 / exit - 1 / entry)
  }
  const base = contracts * market.contractSize
  return side === 'long' ? base * (exit - entry) : base * (entry - exit)
}

/** 手续费（保证金币计价） */
export function feeAmount(market: Market, qty: number, price: number, rate: number): number {
  if (isInverse(market)) return (Math.abs(qty) * market.contractSize * rate) / Math.max(price, EPS)
  return Math.abs(qty) * market.contractSize * price * rate
}

/** 权益 = 初始保证金 − 开仓费 + 未实现盈亏（保证金币） */
function equityAt(
  market: Market,
  side: Side,
  qty: number,
  entry: number,
  price: number,
  marginCoin: number,
): number {
  return marginCoin + grossPnl(market, side, qty, entry, price)
}

/** 二分求强平价格：f(p) = 权益 − 维持保证金 = 0 */
function solveLiqPrice(
  market: Market,
  side: Side,
  qty: number,
  entry: number,
  marginCoin: number,
): { price: number; status: 'ok' | 'safe-to-zero' | 'no-tiers' } {
  const tiers = market.tiers
  if (!tiers.length) return { price: 0, status: 'no-tiers' }
  if (qty <= 0) return { price: 0, status: 'no-tiers' }

  const f = (p: number) =>
    equityAt(market, side, qty, entry, p, marginCoin) - maintenanceMargin(tiers, market, qty, p)

  // 强平价是理论价格，不受最小报价单位约束：1× 多单的强平价常低于 priceTick
  // （如 ADA 1× 约 0.000078 < tick 0.0001），所以下界必须取远小于 tick 的值。
  const minPrice = Math.max(entry * 1e-10, 1e-18)

  if (side === 'long') {
    if (f(entry) <= 0) return { price: entry, status: 'ok' }
    // 价格趋近 0 仍然安全（1× 零手续费多单）：真正不会强平
    if (f(minPrice) > 0) return { price: 0, status: 'safe-to-zero' }
    let lo = minPrice
    let hi = entry
    for (let i = 0; i < 240; i++) {
      const mid = (lo + hi) / 2
      if (f(mid) > 0) hi = mid
      else lo = mid
      if (hi - lo < Math.max(entry * 1e-12, 1e-18)) break
    }
    return { price: (lo + hi) / 2, status: 'ok' }
  }

  if (f(entry) <= 0) return { price: entry, status: 'ok' }
  let lo = entry
  let hi = entry * 1.1 + market.priceTick
  let guard = 0
  while (f(hi) > 0) {
    lo = hi
    hi *= 1.6
    if (guard++ > 400 || !Number.isFinite(hi)) return { price: 0, status: 'safe-to-zero' }
  }
  for (let i = 0; i < 240; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid
    else hi = mid
    if (hi - lo < Math.max(entry * 1e-12, 1e-18)) break
  }
  return { price: (lo + hi) / 2, status: 'ok' }
}

/** 保本价：净盈亏（含双边手续费）= 0 的价格 */
function solveBreakEven(
  market: Market,
  side: Side,
  qty: number,
  entry: number,
  rate: number,
): number {
  if (qty <= 0) return 0
  const openFee = feeAmount(market, qty, entry, rate)
  const netAt = (p: number) =>
    grossPnl(market, side, qty, entry, p) - openFee - feeAmount(market, qty, p, rate)

  const minPrice = Math.max(market.priceTick, entry * 1e-8)
  if (side === 'long') {
    if (netAt(entry) >= 0) return entry
    let lo = entry
    let hi = entry * 1.05
    let guard = 0
    while (netAt(hi) < 0) {
      lo = hi
      hi *= 1.5
      if (guard++ > 300) return 0
    }
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (netAt(mid) < 0) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  if (netAt(entry) >= 0) return entry
  if (netAt(minPrice) < 0) return 0
  let lo = minPrice
  let hi = entry
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (netAt(mid) < 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

function fmtCompact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(2)
}

export function compute(input: CalcInput): CalcResult {
  const { market, side, feeMode, makerFee, takerFee } = input
  const entry = input.entryPrice
  const exit = input.exitPrice
  const qty = Math.abs(input.qty)
  const leverage = Math.max(input.leverage, 1)
  const tiers = market.tiers ?? []

  const warnings: string[] = []
  const notional = notionalUsd(market, qty, entry)
  const qtyBase = baseQuantity(market, qty, entry)
  // 反向合约的保证金以标的币计价：USD 名义 / 杠杆 / 价格
  const margin = isInverse(market)
    ? notional / leverage / Math.max(entry, EPS)
    : notional / leverage
  const { tier, index } = pickTier(tiers, market, qty, entry)

  const entryMaker = feeAmount(market, qty, entry, makerFee)
  const entryTaker = feeAmount(market, qty, entry, takerFee)
  const exitMaker = feeAmount(market, qty, exit, makerFee)
  const exitTaker = feeAmount(market, qty, exit, takerFee)

  const pickRate = feeMode === 'maker' ? makerFee : takerFee
  const openFee = feeMode === 'maker' ? entryMaker : entryTaker
  const closeFee = feeMode === 'maker' ? exitMaker : exitTaker

  const pnlGross = grossPnl(market, side, qty, entry, exit)
  const pnlNet = pnlGross - openFee - closeFee
  const marginCoinPrice = isInverse(market) ? entry : 1

  // 强平：开仓手续费同样占用权益
  const marginCoin = margin - openFee
  const liq = solveLiqPrice(market, side, qty, entry, marginCoin)
  const liqPrice = liq.price
  const hasLiq = liq.status === 'ok' && liqPrice > 0
  const liqDistancePct = hasLiq ? (liqPrice - entry) / entry : 0

  const breakEven = solveBreakEven(market, side, qty, entry, pickRate)
  const mm = maintenanceMargin(tiers, market, qty, entry)
  const liqFee = hasLiq ? feeAmount(market, qty, liqPrice, market.liquidationFee ?? 0) : 0
  const effectiveMaxLeverage = tier?.maxLeverage ?? market.maxLeverage

  if (qty <= 0) warnings.push('开仓数量需大于 0')
  if (market.minNotional > 0 && notional > 0 && notional < market.minNotional)
    warnings.push(
      `名义价值 ${fmtCompact(notional)} 低于最小下单额 ${fmtCompact(market.minNotional)}`,
    )
  if (market.minQty > 0 && qty > 0 && qty < market.minQty)
    warnings.push(`数量低于最小下单单位 ${market.minQty}`)
  if (tier && leverage > tier.maxLeverage)
    warnings.push(`当前名义价值处于第 ${index + 1} 档，最高只能开 ${tier.maxLeverage}×`)
  if (market.maxLeverage > 0 && leverage > market.maxLeverage)
    warnings.push(`超过该合约最高杠杆 ${market.maxLeverage}×`)
  if (liq.status === 'no-tiers' && qty > 0)
    warnings.push('缺少风险档位数据，无法计算强平价格（维持保证金率未知）')
  // 理论强平价低于最小报价单位：数学上有解，但交易所价格不可能走到那里
  if (hasLiq && market.priceTick > 0 && liqPrice < market.priceTick && qty > 0)
    warnings.push(
      `理论强平价 ${fmtCompact(liqPrice)} 低于该合约最小报价单位 ${market.priceTick}，实际几乎不可能被强平`,
    )
  if (qty > 0 && tiers.length && marginCoin <= mm)
    warnings.push('保证金不足以覆盖维持保证金，开仓即触发强平')
  if (leverage >= 50) warnings.push('高杠杆下强平价对标记价格波动极其敏感，实际以标记价格触发')

  // 曲线（保证金币）
  const N = 72
  const spanDown = side === 'long' ? 0.55 : 0.25
  const spanUp = side === 'long' ? 0.25 : 1.2
  const lo = Math.max(entry * (1 - spanDown), market.priceTick || entry * 0.5)
  const hi = entry * (1 + spanUp)
  const prices: number[] = []
  for (let i = 0; i <= N; i++) prices.push(lo + ((hi - lo) * i) / N)
  if (hasLiq) prices.push(liqPrice)
  prices.sort((a, b) => a - b)
  const curve = prices.map((price) => ({
    price,
    equity: equityAt(market, side, qty, entry, price, marginCoin),
    mm: maintenanceMargin(tiers, market, qty, price),
    pnl: grossPnl(market, side, qty, entry, price),
  }))

  const fees: FeeBreakdown = {
    entryMaker,
    entryTaker,
    exitMaker,
    exitTaker,
    openFee,
    closeFee,
    total: openFee + closeFee,
  }

  return {
    unit: market.margin,
    margin,
    notional,
    qty,
    qtyBase,
    pnlGross,
    pnlNet,
    pnlGrossUsd: pnlGross * marginCoinPrice,
    pnlNetUsd: pnlNet * marginCoinPrice,
    roiGross: margin > 0 ? pnlGross / margin : 0,
    roiNet: margin > 0 ? pnlNet / margin : 0,
    fees,
    liqPrice,
    // 仅当「价格趋近 0 仍安全」时才为 true；缺少档位时是 no-tiers，由 UI 单独提示
    noLiquidation: liq.status === 'safe-to-zero',
    liqStatus: liq.status,
    liqDistancePct,
    breakEven,
    mmr: tier?.mmr ?? 0,
    maintenanceMargin: mm,
    effectiveMaxLeverage,
    tierIndex: index,
    tierCount: tiers.length,
    liqFee,
    marginCoinPrice,
    warnings,
    curve,
  }
}
