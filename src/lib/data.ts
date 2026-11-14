import type { Market, RiskTier } from './types'

const OKX = 'https://www.okx.com'

export interface MarketIndex {
  generatedAt: string
  feeNote: string
  sources: Array<{ name: string; status: 'ok' | 'error'; count: number; error?: string }>
  count: number
  markets: Market[]
}

let indexPromise: Promise<MarketIndex> | null = null
interface TiersFile {
  tables: Record<string, { u: RiskTier['unit']; t: number[][] }>
  map: Record<string, string>
}
let tiersPromise: Promise<Record<string, RiskTier[]>> | null = null

const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

export function loadIndex(): Promise<MarketIndex> {
  indexPromise ??= fetch(dataUrl('markets.json'), { cache: 'no-cache' }).then((res) => {
    if (!res.ok) throw new Error(`加载市场数据失败：HTTP ${res.status}`)
    return res.json() as Promise<MarketIndex>
  })
  return indexPromise
}

async function loadTiers(): Promise<Record<string, RiskTier[]>> {
  if (tiersPromise) return tiersPromise
  const promise: Promise<Record<string, RiskTier[]>> = fetch(dataUrl('tiers.json'), {
    cache: 'no-cache',
  })
    .then((res) =>
      res.ok ? (res.json() as Promise<TiersFile>) : ({ tables: {}, map: {} } as TiersFile),
    )
    .then((raw) => {
      const decoded = new Map<string, RiskTier[]>()
      const out: Record<string, RiskTier[]> = {}
      for (const [id, hash] of Object.entries(raw.map ?? {})) {
        let tiers = decoded.get(hash)
        if (!tiers) {
          const table = raw.tables?.[hash]
          if (!table) continue
          tiers = table.t.map(([floor, cap, mmr, cum, maxLeverage]) => ({
            floor,
            cap,
            mmr,
            cum,
            maxLeverage,
            unit: table.u,
          }))
          decoded.set(hash, tiers)
        }
        out[id] = tiers
      }
      return out
    })
    .catch(() => {
      const empty: Record<string, RiskTier[]> = {}
      return empty
    })
  tiersPromise = promise
  return promise
}

/** 合并档位；快照里没有的（OKX 非头部合约）实时补抓一次 */
const tierCache = new Map<string, RiskTier[]>()

export async function tiersFor(market: Market): Promise<RiskTier[]> {
  if (market.tiers?.length) return market.tiers
  if (tierCache.has(market.id)) return tierCache.get(market.id)!

  const snapshot = await loadTiers()
  if (snapshot[market.id]?.length) {
    tierCache.set(market.id, snapshot[market.id])
    return snapshot[market.id]
  }
  if (market.exchange !== 'okx' || !market.okxFamily) return []

  const url =
    market.okxInstType === 'FUTURES'
      ? `${OKX}/api/v5/public/position-tiers?instType=FUTURES&tdMode=isolated&instFamily=${encodeURIComponent(market.okxFamily)}`
      : `${OKX}/api/v5/public/position-tiers?instType=SWAP&tdMode=isolated&uly=${encodeURIComponent(market.okxFamily)}`

  try {
    const res = await fetch(url)
    const json = await res.json()
    const tiers: RiskTier[] = (json?.data ?? [])
      .map((t: Record<string, string>) => ({
        floor: Number(t.minSz) || 0,
        cap: Number(t.maxSz) || 0,
        mmr: Number(t.mmr) || 0,
        cum: 0,
        maxLeverage: Number(t.maxLever) || 0,
        unit: 'contracts' as const,
      }))
      .filter((t: RiskTier) => t.cap > 0 && t.mmr > 0)
      .sort((a: RiskTier, b: RiskTier) => a.floor - b.floor)
    if (tiers.length) tierCache.set(market.id, tiers)
    return tiers
  } catch {
    return []
  }
}

export interface LiveQuote {
  price: number
  source: 'mark' | 'last'
  ts: number
}

/** 实时价格：Binance 用标记价（强平按标记价触发），OKX 只有最新成交价 */
export async function fetchQuote(market: Market): Promise<LiveQuote | null> {
  try {
    if (market.exchange === 'binance') {
      const base = market.group === 'coinm' ? 'https://dapi.binance.com/dapi/v1' : 'https://fapi.binance.com/fapi/v1'
      const res = await fetch(`${base}/premiumIndex?symbol=${market.id}`)
      if (!res.ok) return null
      const json = await res.json()
      const price = Number(json.markPrice ?? json.indexPrice)
      return Number.isFinite(price) && price > 0 ? { price, source: 'mark', ts: Date.now() } : null
    }
    const res = await fetch(`${OKX}/api/v5/market/ticker?instId=${market.id}`)
    if (!res.ok) return null
    const json = await res.json()
    const row = json?.data?.[0]
    const price = Number(row?.last)
    return Number.isFinite(price) && price > 0 ? { price, source: 'last', ts: Number(row.ts) } : null
  } catch {
    return null
  }
}

/** 一次拉全部标记价，用于列表里显示当前价 */
export async function fetchAllMarks(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const jobs = [
    fetch('https://fapi.binance.com/fapi/v1/premiumIndex')
      .then((r) => r.json())
      .then((rows: Array<{ symbol: string; markPrice: string }>) =>
        rows.forEach((x) => out.set(x.symbol, Number(x.markPrice))),
      ),
    fetch('https://dapi.binance.com/dapi/v1/premiumIndex')
      .then((r) => r.json())
      .then((rows: Array<{ symbol: string; markPrice: string }>) =>
        rows.forEach((x) => out.set(x.symbol, Number(x.markPrice))),
      ),
    fetch(`${OKX}/api/v5/market/tickers?instType=SWAP`)
      .then((r) => r.json())
      .then((json) =>
        (json.data ?? []).forEach((x: { instId: string; last: string }) =>
          out.set(x.instId, Number(x.last)),
        ),
      ),
    fetch(`${OKX}/api/v5/market/tickers?instType=FUTURES`)
      .then((r) => r.json())
      .then((json) =>
        (json.data ?? []).forEach((x: { instId: string; last: string }) =>
          out.set(x.instId, Number(x.last)),
        ),
      ),
  ]
  await Promise.allSettled(jobs)
  return out
}
