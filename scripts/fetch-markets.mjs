#!/usr/bin/env node
/**
 * 每日抓取 Binance / OKX 永续合约元数据 → public/data/markets.json
 *
 * - Binance USDⓈ-M：exchangeInfo + 一次性批量风险档位（USDT / USDC / USD1）
 * - Binance COIN-M：dapi exchangeInfo + 逐币种风险档位（档位单位是「币」）
 * - OKX SWAP：USDT 线性 + 反向；OKX 无逐仓档位批量接口，默认只抓成交额前 N 名，
 *   其余由前端在选中合约时实时补抓（OKX 允许跨域）
 * - OKX USDⓈ（USD_UM / XPERP）：结算币为 USD 稳定币，等价于 USDC 保证金市场
 *
 * 失败时保留上一次成功的数据（按 source 合并），不会写出空文件。
 *
 * 用法：NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7897 npm run fetch-data
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data')
const OUT_INDEX = resolve(OUT_DIR, 'markets.json')
const OUT_TIERS = resolve(OUT_DIR, 'tiers.json')
const BINANCE_FAPI = 'https://fapi.binance.com'
const BINANCE_DAPI = 'https://dapi.binance.com'
const BINANCE_WEB = 'https://www.binance.com'
const OKX = 'https://www.okx.com'

const OKX_TIER_LIMIT = Number(process.env.OKX_TIER_LIMIT ?? 160)

// VIP 0 挂单/吃单费率（USDⓈ-M 的 USDC 档位目前为官方促销价）
const FEES = {
  binanceUsdt: { maker: 0.0002, taker: 0.0005 },
  binanceUsdc: { maker: 0, taker: 0.0004 },
  binanceCoinm: { maker: 0.0002, taker: 0.0005 },
  okx: { maker: 0.0002, taker: 0.0005 },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function r(value, digits = 10) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Number(n.toPrecision(digits))
}

async function getJSON(url, { tries = 4, timeout = 20000 } = {}) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeout)
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { accept: 'application/json', 'user-agent': 'liquid-calculator/1.0' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
      await sleep(400 * (i + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`${url} → ${lastErr?.message ?? 'unknown error'}`)
}

const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Binance 风险档位 → 统一档位结构（unit=usd 或 coin；cum 与 cap 同单位） */
function normalizeBinanceTiers(riskBrackets, unit) {
  return riskBrackets
    .map((b) => ({
      floor: r(b.bracketNotionalFloor),
      cap: r(b.bracketNotionalCap),
      mmr: r(b.bracketMaintenanceMarginRate),
      cum: r(b.cumFastMaintenanceAmount ?? 0),
      maxLeverage: r(b.maxOpenPosLeverage),
      unit,
    }))
    .filter((t) => t.cap > 0 && t.mmr > 0)
    .sort((a, b) => a.floor - b.floor)
}

/** OKX 档位：maxSz 单位是「张」，MMR 直接作用于整仓名义价值（cum=0） */
function normalizeOkxTiers(rows) {
  return rows
    .map((t) => ({
      floor: r(num(t.minSz)),
      cap: r(num(t.maxSz)),
      mmr: r(num(t.mmr)),
      cum: 0,
      maxLeverage: r(num(t.maxLever)),
      unit: 'contracts',
    }))
    .filter((t) => t.cap > 0 && t.mmr > 0)
    .sort((a, b) => a.floor - b.floor)
}

async function fetchBinanceUsdm() {
  const [info, brackets] = await Promise.all([
    getJSON(`${BINANCE_FAPI}/fapi/v1/exchangeInfo`, { timeout: 45000 }),
    getJSON(`${BINANCE_WEB}/bapi/futures/v1/friendly/future/common/brackets`, { timeout: 60000 }),
  ])
  const volumes = await getJSON(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, { timeout: 45000 }).catch(
    () => [],
  )
  const tickBySymbol = new Map(volumes.map((t) => [t.symbol, t]))

  // 批量接口里包含所有合约（含已下架/交割），按 exchangeInfo 的 symbol 直接对齐
  const bracketBySymbol = new Map(
    (brackets?.data?.brackets ?? []).map((b) => [b.symbol, b.riskBrackets ?? []]),
  )

  const markets = []
  for (const s of info.symbols ?? []) {
    if (s.contractType !== 'PERPETUAL' || s.status !== 'TRADING') continue
    if (!['USDT', 'USDC', 'USD1'].includes(s.marginAsset)) continue
    if (!['COIN', 'INDEX'].includes(s.underlyingType)) continue

    const tiers = normalizeBinanceTiers(bracketBySymbol.get(s.symbol) ?? [], 'usd')
    if (!tiers.length) continue

    const filters = new Map((s.filters ?? []).map((f) => [f.filterType, f]))
    const fees = s.marginAsset === 'USDT' ? FEES.binanceUsdt : FEES.binanceUsdc

    markets.push({
      id: s.symbol,
      exchange: 'binance',
      type: 'perp',
      base: s.baseAsset,
      quote: s.quoteAsset,
      margin: s.marginAsset,
      settle: s.marginAsset,
      group: s.marginAsset === 'USDT' ? 'usdt' : 'usdc',
      contract: 'linear',
      contractSize: 1,
      contractSizeCcy: s.baseAsset,
      qtyStep: r(num(filters.get('LOT_SIZE')?.stepSize, 0.001)),
      minQty: r(num(filters.get('LOT_SIZE')?.minQty, 0)),
      minNotional: r(num(filters.get('MIN_NOTIONAL')?.notional, 5)),
      priceTick: r(num(filters.get('PRICE_FILTER')?.tickSize, 0.0001)),
      maxLeverage: r(Math.max(...tiers.map((t) => t.maxLeverage))),
      liquidationFee: r(num(s.liquidationFee)),
      makerFee: fees.maker,
      takerFee: fees.taker,
      volume24h: r(num(tickBySymbol.get(s.symbol)?.quoteVolume), 6),
      lastPrice: r(num(tickBySymbol.get(s.symbol)?.lastPrice), 10),
      tiers,
    })
  }
  return markets
}

async function fetchBinanceCoinm() {
  const info = await getJSON(`${BINANCE_DAPI}/dapi/v1/exchangeInfo`, { timeout: 45000 })
  const volumes = await getJSON(`${BINANCE_DAPI}/dapi/v1/ticker/24hr`, { timeout: 45000 }).catch(
    () => [],
  )
  const tickBySymbol = new Map(volumes.map((t) => [t.symbol, t]))

  const symbols = (info.symbols ?? []).filter(
    (s) => s.contractType === 'PERPETUAL' && s.contractStatus === 'TRADING',
  )

  const markets = []
  for (const s of symbols) {
    let rows = []
    try {
      const res = await getJSON(
        `${BINANCE_WEB}/bapi/futures/v1/friendly/future/common/brackets?symbol=${encodeURIComponent(s.symbol)}`,
      )
      rows = res?.data?.brackets?.[0]?.riskBrackets ?? []
    } catch (err) {
      console.warn(`  ! COIN-M 档位失败 ${s.symbol}: ${err.message}`)
      continue
    }
    const tiers = normalizeBinanceTiers(rows, 'coin')
    if (!tiers.length) continue

    const filters = new Map((s.filters ?? []).map((f) => [f.filterType, f]))
    const symbol = s.symbol
    const base = s.marginAsset

    markets.push({
      id: symbol,
      exchange: 'binance',
      type: 'perp',
      base,
      quote: 'USD',
      margin: base,
      settle: base,
      group: 'coinm',
      contract: 'inverse',
      contractSize: r(num(s.contractSize, 100)),
      contractSizeCcy: 'USD',
      qtyStep: r(num(filters.get('LOT_SIZE')?.stepSize, 1)),
      minQty: r(num(filters.get('LOT_SIZE')?.minQty, 1)),
      minNotional: r(num(s.contractSize, 100) * num(filters.get('LOT_SIZE')?.minQty, 1)),
      priceTick: r(num(filters.get('PRICE_FILTER')?.tickSize, 0.1)),
      maxLeverage: r(Math.max(...tiers.map((t) => t.maxLeverage))),
      liquidationFee: r(num(s.liquidationFee)),
      makerFee: FEES.binanceCoinm.maker,
      takerFee: FEES.binanceCoinm.taker,
      // dapi 的 volume 是「张数」，× 面值得到 USD 成交额
      volume24h: r(
        num(tickBySymbol.get(symbol)?.volume) * num(s.contractSize, 100),
        6,
      ),
      lastPrice: r(num(tickBySymbol.get(symbol)?.lastPrice), 10),
      tiers,
    })
  }
  return markets
}

async function fetchOkx() {
  const [swapInfo, futInfo, swapTickers, futTickers] = await Promise.all([
    getJSON(`${OKX}/api/v5/public/instruments?instType=SWAP`, { timeout: 45000 }),
    getJSON(`${OKX}/api/v5/public/instruments?instType=FUTURES`, { timeout: 45000 }),
    getJSON(`${OKX}/api/v5/market/tickers?instType=SWAP`, { timeout: 45000 }),
    getJSON(`${OKX}/api/v5/market/tickers?instType=FUTURES`, { timeout: 45000 }),
  ])

  const tick = new Map((swapTickers?.data ?? []).map((t) => [t.instId, t]))
  const ftick = new Map((futTickers?.data ?? []).map((t) => [t.instId, t]))

  const swaps = (swapInfo?.data ?? []).filter(
    (i) => i.state === 'live' && i.ruleType !== 'pre_market',
  )
  const usdtSwaps = swaps.filter(
    (i) => i.ctType === 'linear' && i.settleCcy === 'USDT' && i.instFamily.endsWith('-USDT'),
  )
  const inverseSwaps = swaps.filter((i) => i.ctType === 'inverse')
  const cryptoBases = new Set(usdtSwaps.map((i) => i.instId.split('-')[0]))

  // USDⓈ（USD_UM / XPERP）：结算与保证金均为 USD 稳定币
  const usdFuts = (futInfo?.data ?? []).filter(
    (i) =>
      i.state === 'live' &&
      i.settleCcy === 'USD' &&
      i.ctType === 'linear' &&
      i.instFamily.endsWith('_XPERP') &&
      cryptoBases.has(i.instFamily.split('-')[0]),
  )

  const build = (i, group, dealCcy, ticker) => {
    const ctVal = num(i.ctVal)
    const isInverse = i.ctType === 'inverse'
    const price = num(ticker?.last)
    const volCcy = num(ticker?.volCcy24h)
    return {
      id: i.instId,
      exchange: 'okx',
      okxFamily: i.instFamily,
      okxInstType: i.instType,
      type: i.instType === 'FUTURES' ? 'future' : 'perp',
      base: i.instFamily.split('-')[0],
      quote: dealCcy,
      // OKX 没有 USDC 本位永续：USD_UM / XPERP 以 USD 稳定币结算，这里如实标 USD
      margin: isInverse ? i.settleCcy : i.settleCcy,
      settle: i.settleCcy,
      group,
      contract: isInverse ? 'inverse' : 'linear',
      contractSize: r(ctVal),
      contractSizeCcy: isInverse ? 'USD' : i.ctValCcy,
      qtyStep: r(num(i.lotSz || 1)),
      minQty: r(num(i.minSz || 1)),
      minNotional: r(isInverse ? ctVal * num(i.minSz || 1) : ctVal * num(i.minSz || 1) * price),
      priceTick: r(num(i.tickSz)),
      maxLeverage: r(num(i.lever)),
      makerFee: FEES.okx.maker,
      takerFee: FEES.okx.taker,
      volume24h: r(volCcy * price, 6),
      lastPrice: r(price, 10),
      expTime: i.expTime ? num(i.expTime) : undefined,
      tiers: [],
    }
  }

  const markets = []
  for (const i of usdtSwaps) markets.push(build(i, 'usdt', 'USDT', tick.get(i.instId)))
  for (const i of inverseSwaps) markets.push(build(i, 'coinm', 'USD', tick.get(i.instId)))
  for (const i of usdFuts) markets.push(build(i, 'usdc', 'USD', ftick.get(i.instId)))

  // 档位：只抓成交额前 N 名，其余交给前端按需实时补抓
  const withTier = [...markets].sort((a, b) => b.volume24h - a.volume24h).slice(0, OKX_TIER_LIMIT)
  let ok = 0
  for (const m of withTier) {
    try {
      const url =
        m.okxInstType === 'FUTURES'
          ? `${OKX}/api/v5/public/position-tiers?instType=FUTURES&tdMode=isolated&instFamily=${encodeURIComponent(m.okxFamily)}`
          : `${OKX}/api/v5/public/position-tiers?instType=SWAP&tdMode=isolated&uly=${encodeURIComponent(m.okxFamily)}`
      const res = await getJSON(url)
      const tiers = normalizeOkxTiers(res?.data ?? [])
      if (tiers.length) {
        m.tiers = tiers
        m.maxLeverage = r(Math.min(m.maxLeverage || Infinity, tiers[0].maxLeverage))
        ok++
      }
    } catch {
      /* 前端会按需补抓 */
    }
    await sleep(45)
  }
  console.log(`  OKX 档位抓取 ${ok}/${withTier.length}`)

  for (const m of markets) {
    if (!m.tiers.length) m.tiers = []
  }
  return markets
}

async function main() {
  const previous = await readFile(OUT_INDEX, 'utf8')
    .then((t) => JSON.parse(t))
    .catch(() => null)

  const sources = []
  const all = []

  const jobs = [
    ['binance-usdm', fetchBinanceUsdm],
    ['binance-coinm', fetchBinanceCoinm],
    ['okx', fetchOkx],
  ]

  for (const [name, fn] of jobs) {
    process.stdout.write(`→ ${name} … `)
    try {
      const markets = await fn()
      all.push(...markets)
      sources.push({ name, status: 'ok', count: markets.length })
      console.log(`${markets.length} 个合约`)
    } catch (err) {
      const kept = (previous?.markets ?? []).filter((m) =>
        name === 'okx' ? m.exchange === 'okx' : m.exchange === 'binance' && m.id.endsWith('_PERP') === (name === 'binance-coinm'),
      )
      all.push(...kept)
      sources.push({ name, status: 'error', count: kept.length, error: String(err.message).slice(0, 300) })
      console.log(`失败（沿用旧数据 ${kept.length} 条）：${err.message}`)
    }
  }

  // 按成交额排序，前端默认展示流动性最好的
  all.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))

  // 档位用紧凑数组存储，并按内容去重（大量合约共用同一张表）：
  // { tables: { "<hash>": { u: 单位, t: [[floor, cap, mmr, cum, maxLeverage], …] } }, map: { instId: "<hash>" } }
  const tables = {}
  const map = {}
  for (const m of all) {
    if (m.tiers?.length) {
      const table = {
        u: m.tiers[0].unit,
        t: m.tiers.map((x) => [x.floor, x.cap, x.mmr, x.cum, x.maxLeverage]),
      }
      const hash = createHash('sha1').update(JSON.stringify(table)).digest('hex').slice(0, 10)
      tables[hash] = table
      map[m.id] = hash
    }
    delete m.tiers
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    feeNote: 'VIP 0 费率；Binance USDC 档位为官方促销价（挂单 0），实际以账户费率为准',
    sources,
    count: all.length,
    markets: all,
  }

  const tiersPayload = JSON.stringify({ tables, map })
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_INDEX, JSON.stringify(payload))
  await writeFile(OUT_TIERS, tiersPayload)
  console.log(
    `\n写出 ${OUT_INDEX}：${all.length} 个合约，${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`,
  )
  console.log(
    `写出 ${OUT_TIERS}：${Object.keys(map).length} 个合约 / ${Object.keys(tables).length} 张唯一档位表，${(tiersPayload.length / 1024).toFixed(0)} KB`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
