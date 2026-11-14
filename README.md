# 合约强平计算器

Binance / OKX 永续合约仓位计算器：选合约、选杠杆、选方向，输入开仓价/平仓价/数量，得到保证金、收益、收益率、手续费与**强平价格**。

- 市场覆盖：Binance USDⓈ-M（USDT / USDC / USD1）、Binance COIN-M（币本位）、OKX USDT 永续、OKX 币本位永续、OKX USDⓈ（`USD_UM` / XPERP，以 USD 稳定币结算）
- 说明：OKX 目前**没有** BTC-USDC 永续（只有 USDC-USDT 交叉盘），其 USDⓈ 系列用 `USD` 结算，界面上如实标注
- 档位驱动：强平价格按**逐仓保证金 + 风险档位 MMR** 求解，跨档自动重算，不是简单的 `1/杠杆`
- 纯静态：GitHub Pages 直出，无需后端；元数据每天抓取一次，价格实时拉取
- 深/浅色主题、桌面与移动端适配

## 开发

```bash
npm install
npm run fetch-data   # 生成 public/data/markets.json 与 tiers.json（需能访问 Binance / OKX）
npm run dev
npm test             # 13 个计算用例：线性 / 反向 / 张数 / 跨档 / 手续费 / 保本价
npm run build
```

国内网络需要代理：`NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7897 npm run fetch-data`。

## 数据流水线

| 文件 | 内容 | 大小 |
|---|---|---|
| `public/data/markets.json` | 全部合约元数据（币种、杠杆、面值、最小下单、VIP0 费率、24h 成交额、快照价） | ~530 KB |
| `public/data/tiers.json` | 风险档位（紧凑数组：`[[floor, cap, mmr, cum, maxLeverage], …]`） | ~150 KB |

抓取来源：

- Binance：`www.binance.com/fapi/v1/exchangeInfo`、`www.binance.com/dapi/v1/exchangeInfo`、`bapi/futures/.../brackets`（批量拿全市场档位）
- OKX：`/api/v5/public/instruments`、`/api/v5/public/position-tiers`（无批量接口，默认抓成交额前 160 名，其余由前端选中时实时补抓）

> **域名说明**：`fapi.binance.com` / `dapi.binance.com` 对美国等地区返回 `451 Unavailable For Legal Reasons`，
> 而 `www.binance.com` 下的同名路径可用。GitHub Actions 跑在美区机房，因此抓取脚本统一走 `www.binance.com`；
> 前端实时价则按 `[www.binance.com, fapi/dapi.binance.com]` 顺序降级，任一可用即可刷新。

`.github/workflows/update-data.yml` 每天 01:17 UTC 跑一次并提交（若某家交易所抓取失败，沿用上一次快照并在日志里给出 warning）；
`.github/workflows/deploy.yml` 在 push 时跑测试 + 构建 + 发布 Pages，并校验 `dist/index.html` 确实引用打包后的 JS。

## 部署（GitHub Pages）

仓库只需设置一次：**Settings → Pages → Build and deployment → Source = `GitHub Actions`**。
之后 push 到 `main` 会自动构建发布，站点地址为 `https://<user>.github.io/<repo>/`（`base` 自动按仓库名推导）。

## 计算口径

| 项目 | 线性（USDT/USDC） | 反向（币本位） |
|---|---|---|
| 名义价值 | 数量 × 合约面值 × 价格 | 张数 × 合约面值（USD） |
| 保证金 | 名义 ÷ 杠杆 | 名义 ÷ 杠杆 ÷ 价格（以币计） |
| 盈亏 | Δ价 × 数量 × 面值 | 名义 × (1/开仓价 − 1/平仓价) |
| 手续费 | 名义 × 费率 | 名义 × 费率 ÷ 价格 |
| 维持保证金 | 档位名义 × MMR − cum | 同上，但档位单位是币 |
| 强平 | 权益（保证金 − 开仓费 + 浮盈亏）= 维持保证金，二分求解 | 同左 |

OKX 档位按**合约张数**分档，Binance 线性按 USD 名义、币本位按币名义。

## 免责

费率为 VIP 0 与官方活动价（Binance USDC 类目前挂单 0），实际以账户费率与交易所规则为准。强平价格按标记价格与档位 MMR 估算，未计资金费率、ADL 与交易所风控调整，仅供仓位规划参考。
