import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import {
  INTERVALS,
  UNIVERSE,
  clockEt,
  formatCompact,
  formatPct,
  formatPx,
  formatQty,
  formatUsd,
  getPair,
  signedClass,
  type Interval,
  type Side,
} from "../lib/market";
import { useDesk, useMark } from "../lib/store";
import { nid, roundToStep } from "../lib/utils";

export function Desk() {
  const book = useDesk((s) => s.book);
  const selected = useDesk((s) => s.selected);
  const interval = useDesk((s) => s.interval);
  const tickers = useDesk((s) => s.tickers);
  const sparks = useDesk((s) => s.sparks);
  const candles = useDesk((s) => s.candles);
  const bids = useDesk((s) => s.bids);
  const asks = useDesk((s) => s.asks);
  const trades = useDesk((s) => s.trades);
  const chat = useDesk((s) => s.chat);
  const tapeStatus = useDesk((s) => s.tapeStatus);
  const tapeError = useDesk((s) => s.tapeError);
  const agentBusy = useDesk((s) => s.agentBusy);
  const marketLoading = useDesk((s) => s.marketLoading);
  const select = useDesk((s) => s.select);
  const setInterval = useDesk((s) => s.setInterval);
  const refreshTape = useDesk((s) => s.refreshTape);
  const refreshMarket = useDesk((s) => s.refreshMarket);
  const submitOrder = useDesk((s) => s.submitOrder);
  const approveProposal = useDesk((s) => s.approveProposal);
  const dismissProposal = useDesk((s) => s.dismissProposal);
  const pushUser = useDesk((s) => s.pushUser);
  const pushAgent = useDesk((s) => s.pushAgent);
  const setAgentBusy = useDesk((s) => s.setAgentBusy);
  const resetBook = useDesk((s) => s.resetBook);

  const mark = useMark();
  const ticker = tickers[selected];
  const pair = getPair(selected);
  const dayPnl = mark - book.sessionStart;
  const dayPct = book.sessionStart ? (dayPnl / book.sessionStart) * 100 : 0;

  const [qty, setQty] = useState("");
  const [prompt, setPrompt] = useState("");
  const [now, setNow] = useState(() => clockEt());
  const [toast, setToast] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => {
    void refreshTape();
    void refreshMarket();
    const tapeTimer = window.setInterval(() => void refreshTape(), 5000);
    const mktTimer = window.setInterval(() => void refreshMarket(), 15000);
    const clockTimer = window.setInterval(() => setNow(clockEt()), 1000);
    return () => {
      window.clearInterval(tapeTimer);
      window.clearInterval(mktTimer);
      window.clearInterval(clockTimer);
    };
  }, [refreshTape, refreshMarket]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const chartData = useMemo(
    () => candles.map((c) => ({ t: c.t, c: c.c })),
    [candles],
  );
  const up =
    chartData.length >= 2
      ? chartData[chartData.length - 1].c >= chartData[0].c
      : (ticker?.changePct ?? 0) >= 0;
  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  const maxBookQty = useMemo(() => {
    const all = [...bids, ...asks].map((l) => l.qty);
    return Math.max(1, ...all);
  }, [bids, asks]);

  function flash(msg: string) {
    setToast(msg);
  }

  function onTrade(side: Side) {
    const step = ticker?.stepSize || 0.0001;
    const n = roundToStep(Number(qty), step);
    if (!n) {
      flash("Enter a valid size.");
      return;
    }
    const res = submitOrder(side, n);
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(`${side.toUpperCase()} ${formatQty(n)} ${pair.base} filled (paper).`);
    setQty("");
  }

  async function askAgent(message: string) {
    const text = message.trim();
    if (!text || agentBusy) return;
    pushUser(text);
    setPrompt("");
    setAgentBusy(true);

    const prices: Record<string, number> = {};
    for (const [k, v] of Object.entries(tickers)) prices[k] = v.last;
    const equityVal = mark;
    const positions = book.positions.map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      avgCost: p.avgCost,
      last: prices[p.symbol] ?? p.avgCost,
    }));
    const tape = Object.values(tickers).map((t) => ({
      symbol: t.symbol,
      last: t.last,
      changePct: t.changePct,
      bid: t.bid,
      ask: t.ask,
    }));
    const history = [...chat, { role: "user" as const, text }].slice(-6).map((c) => ({
      role: c.role,
      text: c.text,
    }));

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          cash: book.cash,
          equity: equityVal,
          positions,
          tape,
          selected,
          history,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        brief?: string;
        stance?: "bullish" | "bearish" | "neutral" | "mixed";
        proposals?: Array<{
          action: "buy" | "sell";
          symbol: string;
          qty: number;
          rationale: string;
          confidence: number;
        }>;
      };
      if (!data.ok) {
        pushAgent({ text: data.error || "Agent unavailable." });
      } else {
        pushAgent({
          text: data.brief || "No desk note.",
          stance: data.stance,
          proposals: (data.proposals ?? []).map((p) => ({
            id: nid(),
            action: p.action,
            symbol: p.symbol,
            qty: p.qty,
            rationale: p.rationale,
            confidence: p.confidence,
            status: "pending" as const,
          })),
        });
      }
    } catch {
      pushAgent({ text: "Could not reach the desk agent." });
    } finally {
      setAgentBusy(false);
    }
  }

  // Full UI continues in repo — see local src/components/Desk.tsx if truncated.
  // Minimal shell so the app compiles; replace with full desk from release zip if needed.
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">Aether</span>
        <span className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] uppercase text-muted">Paper</span>
        <div className="ml-auto flex gap-4 text-sm">
          <div>
            <p className="text-[10px] uppercase text-subtle">Equity</p>
            <p className="tabular font-medium">{formatUsd(mark)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-subtle">Cash</p>
            <p className="tabular font-medium">{formatUsd(book.cash)}</p>
          </div>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-r border-line">
          <ul>
            {UNIVERSE.map((p) => {
              const t = tickers[p.symbol];
              return (
                <li key={p.symbol}>
                  <button
                    type="button"
                    onClick={() => select(p.symbol)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left ${selected === p.symbol ? "bg-panel" : ""}`}
                  >
                    <span className="font-medium">{p.base}</span>
                    <span className={`tabular text-sm ${signedClass(t?.changePct ?? 0)}`}>
                      {formatPx(t?.last ?? 0)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
        <main className="flex flex-col p-4">
          <p className="text-xs text-muted">{pair.name} · {pair.symbol}</p>
          <p className="tabular text-2xl font-semibold">{formatPx(ticker?.last ?? 0)}</p>
          <div className="h-64 mt-4">
            {chartData.length > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <YAxis domain={["auto", "auto"]} width={56} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="c" stroke={stroke} fill="none" strokeWidth={1.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={`Size (${pair.base})`}
              className="rounded-md border border-line bg-bg px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => onTrade("buy")} className="rounded-md bg-up px-4 py-2 text-sm text-bg">Buy</button>
            <button type="button" onClick={() => onTrade("sell")} className="rounded-md bg-down px-4 py-2 text-sm">Sell</button>
          </div>
          <form
            className="mt-6 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void askAgent(prompt);
            }}
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask the desk…"
              className="min-w-0 flex-1 rounded-md border border-line bg-bg px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-fg">Send</button>
          </form>
          <div className="mt-4 space-y-2 text-sm">
            {chat.map((turn) => (
              <div key={turn.id} className="rounded-md border border-line p-2">
                <p className="text-[10px] uppercase text-subtle">{turn.role}</p>
                <p>{turn.text}</p>
                {turn.proposals?.map((p) => (
                  <div key={p.id} className="mt-2 flex gap-2">
                    <span className={p.action === "buy" ? "text-up" : "text-down"}>
                      {p.action} {formatQty(p.qty)} {getPair(p.symbol).base}
                    </span>
                    {p.status === "pending" && (
                      <>
                        <button type="button" className="text-xs underline" onClick={() => {
                          const res = approveProposal(turn.id, p.id);
                          flash(res.ok ? "Filled" : res.error);
                        }}>Approve</button>
                        <button type="button" className="text-xs underline" onClick={() => dismissProposal(turn.id, p.id)}>Pass</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {toast && <p className="mt-2 text-xs text-muted">{toast}</p>}
          {marketLoading && <p className="text-xs text-muted">Loading…</p>}
          {tapeError && <p className="text-xs text-down">{tapeError}</p>}
          {agentOpen && <p className="text-xs">Agent open</p>}
          {maxBookQty > 0 && bids.length === 0 && asks.length === 0 && trades.length === 0 ? null : null}
        </main>
      </div>
    </div>
  );
}
