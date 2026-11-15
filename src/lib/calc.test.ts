import { describe, expect, it } from 'vitest'
import { compute } from './calc'
import type { Market, RiskTier } from './types'

const tier = (floor: number, cap: number, mmr: number, cum = 0, maxLeverage = 125, unit: RiskTier['unit'] = 'usd'): RiskTier => ({
  floor,
  cap,
  mmr,
  cum,
  maxLeverage,
  unit,
})

function market(over: Partial<Market>): Market {
  return {
    id: 'TEST',
    exchange: 'binance',
    type: 'perp',
    base: 'BTC',
    quote: 'USDT',
    margin: 'USDT',
    settle: 'USDT',
    group: 'usdt',
    contract: 'linear',
    contractSize: 1,
    contractSizeCcy: 'BTC',
    qtyStep: 0.001,
    minQty: 0.001,
    minNotional: 5,
    priceTick: 0.1,
    maxLeverage: 125,
    makerFee: 0.0002,
    takerFee: 0.0005,
    volume24h: 0,
    tiers: [tier(0, 300000, 0.004), tier(300000, 800000, 0.005, 300, 100)],
    ...over,
  }
}

describe('Binance USDT 线性', () => {
  const m = market({})

  it('保证金 = 名义 / 杠杆', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(res.notional).toBeCloseTo(6000, 6)
    expect(res.margin).toBeCloseTo(600, 6)
  })

  it('多单强平价：权益 = 维持保证金（含开仓费）', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 600 − 3 + 0.1(p − 60000) = 0.1p × 0.004  →  p ≈ 54247.0
    expect(res.liqPrice).toBeCloseTo(54246.99, 0)
    expect(res.liqPrice).toBeLessThan(60000)
  })

  it('空单强平价对称', () => {
    const res = compute({
      market: m,
      side: 'short',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 600 − 3 + 0.1(60000 − p) = 0.1p × 0.004 → p ≈ 66334.7
    expect(res.liqPrice).toBeGreaterThan(60000)
    const equity = 597 + 0.1 * (60000 - res.liqPrice)
    const mm = 0.1 * res.liqPrice * 0.004
    expect(equity - mm).toBeCloseTo(0, 4)
  })

  it('收益与收益率含手续费', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 66000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(res.pnlGross).toBeCloseTo(600, 6)
    // 开仓 3 + 平仓 3.3
    expect(res.pnlNet).toBeCloseTo(593.7, 6)
    expect(res.roiGross).toBeCloseTo(1, 6)
    expect(res.roiNet).toBeCloseTo(593.7 / 600, 6)
  })

  it('保本价覆盖双边手续费', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 0.1(be − 60000) = 3 + 0.1×be×0.0005  →  be ≈ 60060.03
    expect(res.breakEven).toBeGreaterThan(60000)
    expect(res.breakEven).toBeCloseTo(60060.03, 1)
    expect(res.breakEven).toBeGreaterThan(res.liqPrice)
  })

  it('跨档位时 mmr 提升', () => {
    const small = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    const big = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 10,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(small.tierIndex).toBe(0)
    expect(big.tierIndex).toBe(1)
    expect(big.mmr).toBeGreaterThan(small.mmr)
    expect(big.effectiveMaxLeverage).toBe(100)
  })

  it('1x 多单强平价极低但仍可算出（不应报「不会强平」）', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 1,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 0.1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 开仓手续费 3 USDT 会把权益拖到维持保证金之下，强平价约 32.8
    expect(res.liqStatus).toBe('ok')
    expect(res.liqPrice).toBeGreaterThan(0)
    expect(res.liqPrice / 60000).toBeLessThan(0.01)
  })

  it('低价币 1x：强平价低于最小报价单位时仍必须给出数值', () => {
    // 回归：曾把求解下界写成 priceTick，导致 ADA/TRUMP 这类低价币 1× 多单显示「无强平价」
    const low = market({
      id: 'ADAUSDT',
      base: 'ADA',
      priceTick: 0.0001,
      tiers: [tier(0, 10000, 0.005, 0, 75)],
    })
    const res = compute({
      market: low,
      side: 'long',
      leverage: 1,
      entryPrice: 0.1558,
      exitPrice: 0.1558,
      qty: 1,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(res.liqStatus).toBe('ok')
    expect(res.liqPrice).toBeGreaterThan(0)
    // 解析解：开仓费 0.1558×0.0005 ÷ (1 − 0.005) ≈ 0.0000783
    expect(res.liqPrice).toBeCloseTo(0.0000783, 6)
    expect(res.liqPrice).toBeLessThan(low.priceTick)
  })

  it('缺档位时不谎报「归零前不会强平」', () => {
    const noTiers = market({ id: 'X', tiers: [] })
    const res = compute({
      market: noTiers,
      side: 'long',
      leverage: 1,
      entryPrice: 100,
      exitPrice: 100,
      qty: 1,
      feeMode: 'taker',
      makerFee: 0.0002,
      takerFee: 0.0005,
    })
    expect(res.liqStatus).toBe('no-tiers')
    expect(res.noLiquidation).toBe(false)
    expect(res.warnings.some((w) => w.includes('缺少风险档位'))).toBe(true)
  })
})

describe('Binance COIN-M 反向', () => {
  const m = market({
    id: 'BTCUSD_PERP',
    group: 'coinm',
    contract: 'inverse',
    quote: 'USD',
    margin: 'BTC',
    settle: 'BTC',
    contractSize: 100,
    contractSizeCcy: 'USD',
    qtyStep: 1,
    minQty: 1,
    tiers: [tier(0, 5, 0.004, 0, 125, 'coin'), tier(5, 10, 0.005, 0.005, 100, 'coin')],
  })

  it('保证金以币计价', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 100, // 100 张 × 100 USD = 10,000 USD
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(res.notional).toBeCloseTo(10000, 6)
    // 档位按币：10000/60000 = 0.1667 BTC，落在第 1 档（0~5 BTC）
    expect(res.tierIndex).toBe(0)
    expect(res.margin).toBeCloseTo(10000 / 10 / 60000, 10)
    expect(res.unit).toBe('BTC')
    expect(res.marginCoinPrice).toBe(60000)
  })

  it('档位按保证金币匹配，跨档后 mmr 提升', () => {
    const small = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 100,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 4000 张 = 400,000 USD → 6.67 BTC → 第 2 档（5~10 BTC）
    const big = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 4000,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(small.tierIndex).toBe(0)
    expect(big.tierIndex).toBe(1)
    expect(big.mmr).toBeGreaterThan(small.mmr)
  })

  it('反向多单强平价满足 权益 = 维持保证金', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 100,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    const p = res.liqPrice
    const margin = 10000 / 10 / 60000
    const openFee = (10000 * 0.0005) / 60000
    const equity = margin - openFee + 10000 * (1 / 60000 - 1 / p)
    const mm = (10000 / p) * 0.004 // 第 1 档 cum=0
    expect(equity - mm).toBeCloseTo(0, 7)
    expect(p).toBeLessThan(60000)
  })

  it('反向盈亏以币计，折美元与原值一致', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 66000,
      qty: 100,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 10000 × (1/60000 − 1/66000) = 0.0151515 BTC
    expect(res.pnlGross).toBeCloseTo(10000 * (1 / 60000 - 1 / 66000), 10)
    expect(res.pnlGrossUsd).toBeCloseTo(res.pnlGross * 60000, 6)
    expect(res.pnlGrossUsd).toBeGreaterThan(900)
  })
})

describe('OKX 张数计价', () => {
  const m = market({
    exchange: 'okx',
    id: 'BTC-USDT-SWAP',
    contractSize: 0.01,
    contractSizeCcy: 'BTC',
    qtyStep: 0.1,
    minQty: 0.1,
    maxLeverage: 100,
    tiers: [tier(0, 1000, 0.004, 0, 100, 'contracts')],
  })

  it('张数 × 面值 = 名义', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 100,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    expect(res.notional).toBeCloseTo(60000, 6)
    expect(res.qtyBase).toBeCloseTo(1, 9)
    expect(res.margin).toBeCloseTo(6000, 6)
  })

  it('强平价与线性口径一致', () => {
    const res = compute({
      market: m,
      side: 'long',
      leverage: 10,
      entryPrice: 60000,
      exitPrice: 60000,
      qty: 100,
      feeMode: 'taker',
      makerFee: m.makerFee,
      takerFee: m.takerFee,
    })
    // 6000 − 30 + 1×(p−60000) = p×0.004 → p ≈ 54246.99
    expect(res.liqPrice).toBeCloseTo(54246.99, 0)
  })
})
