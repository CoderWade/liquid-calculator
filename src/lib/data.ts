import type { Market, RiskTier } from './types'

const OKX = 'https://www.okx.com'
// fapi.binance.com 在部分地区（如美国）返回 451；www.binance.com 的同名路径可用，
// 因此优先用 www 域名，失败再退回官方 API 域名。
const BN_FAPI = ['https://www.binance.com', 'https://fapi.binance.com']
const BN_DAPI = ['https://www.binance.com', 'https://dapi.binance.com']

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

/** 依次尝试多个域名，返回首个成功解析的 JSON */
async function fetchFirstJson(urls: string[]): Promise<unknown | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      return await res.json()
    } catch {
      /* 换下一个 */
    }
  }
  return null
}

/** 实时价格：Binance 用标记价（强平按标记价触发），OKX 只有最新成交价 */
export async function fetchQuote(market: Market): Promise<LiveQuote | null> {
  try {
    if (market.exchange === 'binance') {
      const bases = market.group === 'coinm' ? BN_DAPI : BN_FAPI
      const path = market.group === 'coinm' ? '/dapi/v1' : '/fapi/v1'
      const json = (await fetchFirstJson(
        bases.map((b) => `${b}${path}/premiumIndex?symbol=${market.id}`),
      )) as { markPrice?: string; indexPrice?: string } | null
      if (!json) return null
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

  const takeMark = (rows: unknown) => {
    if (!Array.isArray(rows)) return
    for (const r of rows as Array<{ symbol?: string; markPrice?: string }>) {
      if (r.symbol && r.markPrice) out.set(r.symbol, Number(r.markPrice))
    }
  }
  const takeLast = (json: unknown) => {
    const data = (json as { data?: Array<{ instId?: string; last?: string }> } | null)?.data
    if (!Array.isArray(data)) return
    for (const r of data) {
      if (r.instId && r.last) out.set(r.instId, Number(r.last))
    }
  }

  // Binance：两个市场各试两个域名，成功即止
  const fetchBinanceMarks = async (bases: string[], path: string) => {
    for (const base of bases) {
      try {
        const res = await fetch(`${base}${path}/premiumIndex`)
        if (!res.ok) continue
        takeMark(await res.json())
        return
      } catch {
        /* 换下一个域名 */
      }
    }
  }

  await Promise.allSettled([
    fetchBinanceMarks(BN_FAPI, '/fapi/v1'),
    fetchBinanceMarks(BN_DAPI, '/dapi/v1'),
    fetch(`${OKX}/api/v5/market/tickers?instType=SWAP`)
      .then((r) => r.json())
      .then(takeLast),
    fetch(`${OKX}/api/v5/market/tickers?instType=FUTURES`)
      .then((r) => r.json())
      .then(takeLast),
  ])
  return out
}
