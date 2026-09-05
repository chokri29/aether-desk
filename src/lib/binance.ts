import { INTERVALS, UNIVERSE, type Candle, type Interval, type TapeTrade, type Ticker } from "./market";

const SYMBOLS = UNIVERSE.map((p) => p.symbol);
const PREFIX = "/binance";

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function encodeSymbols(symbols: string[]) {
  return encodeURIComponent(JSON.stringify(symbols));
}

type Filters = { stepSize: number; tickSize: number };
let filterCache: Record<string, Filters> | null = null;

async function getJson(path: string) {
  const res = await fetch(`${PREFIX}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  return res.json();
}

async function loadFilters(): Promise<Record<string, Filters>> {
  if (filterCache) return filterCache;
  try {
    const info = (await getJson(
      `/api/v3/exchangeInfo?symbols=${encodeSymbols(SYMBOLS)}`,
    )) as {
      symbols?: Array<{
        symbol: string;
        filters: Array<{ filterType: string; stepSize?: string; tickSize?: string }>;
      }>;
    };
    const next: Record<string, Filters> = {};
    for (const s of info.symbols ?? []) {
      const lot = s.filters.find((f) => f.filterType === "LOT_SIZE");
      const px = s.filters.find((f) => f.filterType === "PRICE_FILTER");
      next[s.symbol] = {
        stepSize: num(lot?.stepSize) || 0.0001,
        tickSize: num(px?.tickSize) || 0.01,
      };
    }
    filterCache = next;
    return next;
  } catch {
    return {};
  }
}

export async function fetchTape(): Promise<{ tickers: Ticker[]; ts: number }> {
  const [raw, filters] = await Promise.all([
    getJson(`/api/v3/ticker/24hr?symbols=${encodeSymbols(SYMBOLS)}`) as Promise<
      Array<Record<string, string>>
    >,
    loadFilters(),
  ]);

  const tickers: Ticker[] = (Array.isArray(raw) ? raw : []).map((row) => {
    const symbol = row.symbol;
    const f = filters[symbol] ?? { stepSize: 0.0001, tickSize: 0.01 };
    return {
      symbol,
      last: num(row.lastPrice),
      open: num(row.openPrice),
      high: num(row.highPrice),
      low: num(row.lowPrice),
      change: num(row.priceChange),
      changePct: num(row.priceChangePercent),
      volume: num(row.volume),
      quoteVolume: num(row.quoteVolume),
      bid: num(row.bidPrice),
      ask: num(row.askPrice),
      stepSize: f.stepSize,
      tickSize: f.tickSize,
    };
  });

  return { tickers, ts: Date.now() };
}

export async function fetchMarket(
  symbol: string,
  interval: Interval,
): Promise<{
  candles: Candle[];
  bids: { price: number; qty: number }[];
  asks: { price: number; qty: number }[];
  trades: TapeTrade[];
}> {
  const spec = INTERVALS.find((i) => i.id === interval) ?? INTERVALS[0];
  const pair = UNIVERSE.some((p) => p.symbol === symbol) ? symbol : UNIVERSE[0].symbol;

  const [kraw, draw, traw] = await Promise.all([
    getJson(
      `/api/v3/klines?symbol=${pair}&interval=${spec.binance}&limit=${spec.limit}`,
    ) as Promise<unknown[][]>,
    getJson(`/api/v3/depth?symbol=${pair}&limit=12`) as Promise<{
      bids: string[][];
      asks: string[][];
    }>,
    getJson(`/api/v3/trades?symbol=${pair}&limit=18`) as Promise<
      Array<{ id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }>
    >,
  ]);

  const candles: Candle[] = (Array.isArray(kraw) ? kraw : [])
    .map((row) => ({
      t: num(row[0]),
      o: num(row[1]),
      h: num(row[2]),
      l: num(row[3]),
      c: num(row[4]),
      v: num(row[5]),
    }))
    .filter((c) => c.c > 0);

  const bids = (draw.bids ?? []).map(([price, qty]) => ({
    price: num(price),
    qty: num(qty),
  }));
  const asks = (draw.asks ?? []).map(([price, qty]) => ({
    price: num(price),
    qty: num(qty),
  }));
  const trades: TapeTrade[] = (Array.isArray(traw) ? traw : []).map((t) => ({
    id: t.id,
    price: num(t.price),
    qty: num(t.qty),
    time: t.time,
    sell: Boolean(t.isBuyerMaker),
  }));

  return { candles, bids, asks, trades };
}
