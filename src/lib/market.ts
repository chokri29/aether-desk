export const STARTING_USDT = 100_000;

export const UNIVERSE = [
  { base: "BTC", name: "Bitcoin", symbol: "BTCUSDT" },
  { base: "ETH", name: "Ethereum", symbol: "ETHUSDT" },
  { base: "SOL", name: "Solana", symbol: "SOLUSDT" },
  { base: "BNB", name: "BNB", symbol: "BNBUSDT" },
  { base: "XRP", name: "XRP", symbol: "XRPUSDT" },
  { base: "DOGE", name: "Dogecoin", symbol: "DOGEUSDT" },
  { base: "ADA", name: "Cardano", symbol: "ADAUSDT" },
  { base: "AVAX", name: "Avalanche", symbol: "AVAXUSDT" },
  { base: "LINK", name: "Chainlink", symbol: "LINKUSDT" },
  { base: "DOT", name: "Polkadot", symbol: "DOTUSDT" },
  { base: "LTC", name: "Litecoin", symbol: "LTCUSDT" },
  { base: "UNI", name: "Uniswap", symbol: "UNIUSDT" },
] as const;

export type Pair = (typeof UNIVERSE)[number];
export type Interval = "1D" | "1W" | "1M" | "3M";
export type Side = "buy" | "sell";
export type Stance = "bullish" | "bearish" | "neutral" | "mixed";

export const INTERVALS: { id: Interval; label: string; binance: string; limit: number }[] = [
  { id: "1D", label: "1D", binance: "5m", limit: 288 },
  { id: "1W", label: "1W", binance: "1h", limit: 168 },
  { id: "1M", label: "1M", binance: "4h", limit: 180 },
  { id: "3M", label: "3M", binance: "1d", limit: 90 },
];

export function getPair(symbol: string): Pair {
  return UNIVERSE.find((p) => p.symbol === symbol || p.base === symbol) ?? UNIVERSE[0];
}

export type Ticker = {
  symbol: string;
  last: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  quoteVolume: number;
  bid: number;
  ask: number;
  stepSize: number;
  tickSize: number;
};

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type BookLevel = { price: number; qty: number };
export type TapeTrade = { id: number; price: number; qty: number; time: number; sell: boolean };

export type Position = { symbol: string; qty: number; avgCost: number };
export type Fill = {
  id: string;
  ts: number;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
};
export type Book = {
  cash: number;
  positions: Position[];
  fills: Fill[];
  sessionStart: number;
};

export type Proposal = {
  id: string;
  action: Side;
  symbol: string;
  qty: number;
  rationale: string;
  confidence: number;
  status: "pending" | "filled" | "dismissed";
};

export type ChatTurn = {
  id: string;
  role: "user" | "agent";
  text: string;
  stance?: Stance;
  proposals?: Proposal[];
  ts: number;
};

export function emptyBook(): Book {
  return { cash: STARTING_USDT, positions: [], fills: [], sessionStart: STARTING_USDT };
}

export function fillPrice(ticker: Ticker | undefined, side: Side) {
  if (!ticker) return 0;
  if (side === "buy") return ticker.ask || ticker.last;
  return ticker.bid || ticker.last;
}

export function equity(book: Book, prices: Record<string, number>) {
  const mtm = book.positions.reduce((sum, p) => sum + p.qty * (prices[p.symbol] ?? p.avgCost), 0);
  return book.cash + mtm;
}

export function placeOrder(
  book: Book,
  order: { symbol: string; side: Side; qty: number; price: number; id: string },
): { ok: true; book: Book; fill: Fill } | { ok: false; error: string } {
  const qty = order.qty;
  const price = order.price;
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Size must be greater than zero." };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "No Binance last to fill against." };

  const notional = qty * price;
  const positions = book.positions.map((p) => ({ ...p }));

  if (order.side === "buy") {
    if (notional > book.cash + 1e-8) return { ok: false, error: "Not enough USDT in the paper book." };
    const existing = positions.find((p) => p.symbol === order.symbol);
    if (existing) {
      const total = existing.qty * existing.avgCost + notional;
      existing.qty += qty;
      existing.avgCost = total / existing.qty;
    } else {
      positions.push({ symbol: order.symbol, qty, avgCost: price });
    }
    const fill: Fill = {
      id: order.id,
      ts: Date.now(),
      symbol: order.symbol,
      side: "buy",
      qty,
      price,
    };
    return {
      ok: true,
      fill,
      book: {
        ...book,
        cash: book.cash - notional,
        positions,
        fills: [fill, ...book.fills].slice(0, 250),
      },
    };
  }

  const existing = positions.find((p) => p.symbol === order.symbol);
  if (!existing || existing.qty + 1e-12 < qty) {
    return { ok: false, error: "Not enough inventory to sell." };
  }
  existing.qty -= qty;
  const next =
    existing.qty <= 1e-10 ? positions.filter((p) => p.symbol !== order.symbol) : positions;
  const fill: Fill = {
    id: order.id,
    ts: Date.now(),
    symbol: order.symbol,
    side: "sell",
    qty,
    price,
  };
  return {
    ok: true,
    fill,
    book: {
      ...book,
      cash: book.cash + notional,
      positions: next,
      fills: [fill, ...book.fills].slice(0, 250),
    },
  };
}

export function formatUsd(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? digits : abs >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

export function formatPx(n: number) {
  if (!Number.isFinite(n) || n === 0) return "—";
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatQty(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

export function formatPct(n: number) {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatCompact(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

export function signedClass(n: number) {
  if (n > 1e-9) return "text-up";
  if (n < -1e-9) return "text-down";
  return "text-muted";
}

export function clockEt(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
}
