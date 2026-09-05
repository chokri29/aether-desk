# Aether Desk

AI paper-trading desk marked to the **live Binance USDT spot tape**.

- Live 24h tickers, klines, order book, and last prints (Binance public API)
- Paper book starting at **100,000 USDT** (localStorage)
- **Grok** desk agent proposes trades; you approve or pass
- No live exchange orders — paper fills only at bid/ask

> Not financial advice. Public market data may be delayed. This is a research / education desk, not a broker.

## Quick start

```bash
npm install
export XAI_API_KEY=your_xai_key   # required for the agent
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Without `XAI_API_KEY`, the tape, chart, and paper trading still work; the agent returns an unavailable message.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4
- Zustand (persisted paper book)
- Recharts
- Binance public REST via Vite proxy (`/binance` → `data-api.binance.vision`)
- xAI Chat Completions (`grok-4.5`) on `POST /api/agent` (dev middleware)

## Agent

User-initiated only. Sends a compact book + tape snapshot and asks for a structured desk note:

- `brief` — short institutional note
- `stance` — bullish | bearish | neutral | mixed
- `proposals[]` — optional buy/sell with size, rationale, confidence

Approving a proposal fills the paper book at the current ask (buy) or bid (sell).

## Universe

BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, DOT, LTC, UNI — all vs USDT.

## Binance Agent OS

This repo uses **public market data**, not the authenticated [Binance Agent OS / MCP](https://www.binance.com/en/agent-os) trading server. Live account trading would require connecting Binance MCP (or API keys) in a client that supports it and funding an Agentic sub-account — that path is intentionally out of scope here.

## License

MIT
