export type Exchange = 'binance' | 'okx'
export type MarketGroup = 'usdt' | 'usdc' | 'coinm'
export type ContractKind = 'linear' | 'inverse'
export type Side = 'long' | 'short'

/** 档位数值单位：usd=计价币(USD)，coin=保证金币(币本位)，contracts=合约张数 */
export type TierUnit = 'usd' | 'coin' | 'contracts'

export interface RiskTier {
  /** 档位下界（含） */
  floor: number
  /** 档位上界 */
  cap: number
  /** 维持保证金率 */
  mmr: number
  /** 维持保证金 = 名义价值 × mmr − cum，与档位同单位 */
  cum: number
  maxLeverage: number
  unit: TierUnit
}

export interface Market {
  id: string
  exchange: Exchange
  type: 'perp' | 'future'
  base: string
  quote: string
  /** 保证金币种（COIN-M 为标的币） */
  margin: string
  settle: string
  group: MarketGroup
  contract: ContractKind
  /** 一张合约的规模：linear 为标的数量，inverse 为 USD 名义 */
  contractSize: number
  contractSizeCcy: string
  /** 最小下单单位（Binance 线性为币，OKX 为张） */
  qtyStep: number
  minQty: number
  minNotional: number
  priceTick: number
  maxLeverage: number
  liquidationFee?: number
  makerFee: number
  takerFee: number
  volume24h: number
  lastPrice?: number
  expTime?: number
  /** OKX 按档位补抓时需要 */
  okxFamily?: string
  okxInstType?: string
  tiers: RiskTier[]
}

export interface CalcInput {
  market: Market
  side: Side
  leverage: number
  entryPrice: number
  exitPrice: number
  /** 下单单位：Binance 线性为标的币数量，OKX 与反向合约为张数 */
  qty: number
  feeMode: 'maker' | 'taker'
  makerFee: number
  takerFee: number
}

export interface FeeBreakdown {
  entryMaker: number
  entryTaker: number
  exitMaker: number
  exitTaker: number
  /** 按当前 feeMode 计入选中的开仓/平仓费 */
  openFee: number
  closeFee: number
  total: number
}

export interface CurvePoint {
  price: number
  equity: number
  mm: number
  pnl: number
}

export interface CalcResult {
  /** 保证金币种符号 */
  unit: string
  notional: number
  /** 下单单位数量（张或币），与输入一致 */
  qty: number
  /** 对应的标的币数量 */
  qtyBase: number
  margin: number
  pnlGross: number
  pnlNet: number
  roiGross: number
  roiNet: number
  fees: FeeBreakdown
  liqPrice: number
  /** 价格归零前不会强平（如 1× 多单） */
  noLiquidation: boolean
  /** 强平价相对开仓价的距离，带方向 */
  liqDistancePct: number
  breakEven: number
  mmr: number
  maintenanceMargin: number
  effectiveMaxLeverage: number
  tierIndex: number
  tierCount: number
  liqFee: number
  pnlGrossUsd: number
  pnlNetUsd: number
  /** 1 单位保证金币折合多少 USD */
  marginCoinPrice: number
  warnings: string[]
  curve: CurvePoint[]
}
