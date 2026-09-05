import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchMarket, fetchTape } from "./binance";
import {
  emptyBook,
  equity,
  fillPrice,
  placeOrder,
  type Book,
  type BookLevel,
  type Candle,
  type ChatTurn,
  type Interval,
  type Side,
  type Stance,
  type TapeTrade,
  type Ticker,
} from "./market";
import { nid, roundToStep } from "./utils";

type DeskState = {
  hydrated: boolean;
  book: Book;
  selected: string;
  interval: Interval;
  tickers: Record<string, Ticker>;
  sparks: Record<string, number[]>;
  candles: Candle[];
  bids: BookLevel[];
  asks: BookLevel[];
  trades: TapeTrade[];
  chat: ChatTurn[];
  tapeStatus: "idle" | "live" | "error";
  tapeError: string | null;
  tapeTs: number;
  marketLoading: boolean;
  agentBusy: boolean;
  hydrate: () => void;
  select: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
  refreshTape: () => Promise<void>;
  refreshMarket: () => Promise<void>;
  submitOrder: (side: Side, qty: number) => { ok: true } | { ok: false; error: string };
  approveProposal: (
    turnId: string,
    proposalId: string,
  ) => { ok: true } | { ok: false; error: string };
  dismissProposal: (turnId: string, proposalId: string) => void;
  pushUser: (text: string) => void;
  pushAgent: (turn: {
    text: string;
    stance?: Stance;
    proposals?: ChatTurn["proposals"];
  }) => void;
  setAgentBusy: (busy: boolean) => void;
  resetBook: () => void;
};

function pricesFrom(tickers: Record<string, Ticker>) {
  const prices: Record<string, number> = {};
  for (const [k, v] of Object.entries(tickers)) prices[k] = v.last;
  return prices;
}

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      book: emptyBook(),
      selected: "BTCUSDT",
      interval: "1D",
      tickers: {},
      sparks: {},
      candles: [],
      bids: [],
      asks: [],
      trades: [],
      chat: [],
      tapeStatus: "idle",
      tapeError: null,
      tapeTs: 0,
      marketLoading: false,
      agentBusy: false,
      hydrate: () => set({ hydrated: true }),
      select: (symbol) => {
        if (symbol === get().selected) return;
        set({ selected: symbol, candles: [], bids: [], asks: [], trades: [] });
        void get().refreshMarket();
      },
      setInterval: (interval) => {
        if (interval === get().interval) return;
        set({ interval });
        void get().refreshMarket();
      },
      refreshTape: async () => {
        try {
          const res = await fetchTape();
          const tickers: Record<string, Ticker> = { ...get().tickers };
          const sparks: Record<string, number[]> = { ...get().sparks };
          for (const t of res.tickers) {
            tickers[t.symbol] = t;
            sparks[t.symbol] = [...(sparks[t.symbol] ?? []), t.last].slice(-40);
          }
          set({
            tickers,
            sparks,
            tapeStatus: "live",
            tapeError: null,
            tapeTs: res.ts,
          });
        } catch {
          set({
            tapeStatus: "error",
            tapeError: "Binance tape unreachable. Retrying.",
          });
        }
      },
      refreshMarket: async () => {
        const { selected, interval } = get();
        set({ marketLoading: true });
        try {
          const res = await fetchMarket(selected, interval);
          set({
            candles: res.candles,
            bids: res.bids,
            asks: res.asks,
            trades: res.trades,
            marketLoading: false,
          });
        } catch {
          set({ marketLoading: false });
        }
      },
      submitOrder: (side, qty) => {
        const { book, selected, tickers } = get();
        const ticker = tickers[selected];
        const step = ticker?.stepSize || 0.0001;
        const sized = roundToStep(qty, step);
        const price = fillPrice(ticker, side);
        const result = placeOrder(book, {
          symbol: selected,
          side,
          qty: sized,
          price,
          id: nid(),
        });
        if (!result.ok) return result;
        set({ book: result.book });
        return { ok: true };
      },
      approveProposal: (turnId, proposalId) => {
        const { chat, book, tickers } = get();
        const turn = chat.find((c) => c.id === turnId);
        const proposal = turn?.proposals?.find((p) => p.id === proposalId);
        if (!proposal || proposal.status !== "pending") {
          return { ok: false, error: "Proposal is no longer open." };
        }
        const ticker = tickers[proposal.symbol];
        const step = ticker?.stepSize || 0.0001;
        const qty = roundToStep(proposal.qty, step);
        const price = fillPrice(ticker, proposal.action);
        const result = placeOrder(book, {
          symbol: proposal.symbol,
          side: proposal.action,
          qty,
          price,
          id: nid(),
        });
        if (!result.ok) return result;
        set({
          book: result.book,
          selected: proposal.symbol,
          chat: chat.map((c) =>
            c.id !== turnId
              ? c
              : {
                  ...c,
                  proposals: c.proposals?.map((p) =>
                    p.id === proposalId ? { ...p, status: "filled" as const } : p,
                  ),
                },
          ),
        });
        return { ok: true };
      },
      dismissProposal: (turnId, proposalId) => {
        set({
          chat: get().chat.map((c) =>
            c.id !== turnId
              ? c
              : {
                  ...c,
                  proposals: c.proposals?.map((p) =>
                    p.id === proposalId ? { ...p, status: "dismissed" as const } : p,
                  ),
                },
          ),
        });
      },
      pushUser: (text) => {
        set({
          chat: [
            ...get().chat,
            { id: nid(), role: "user", text, ts: Date.now() },
          ].slice(-40),
        });
      },
      pushAgent: (turn) => {
        set({
          chat: [
            ...get().chat,
            { id: nid(), role: "agent", ts: Date.now(), ...turn },
          ].slice(-40),
        });
      },
      setAgentBusy: (agentBusy) => set({ agentBusy }),
      resetBook: () => set({ book: emptyBook() }),
    }),
    {
      name: "aether-desk",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        book: s.book,
        selected: s.selected,
        interval: s.interval,
        chat: s.chat,
      }),
    },
  ),
);

export function useMark() {
  return useDesk((s) => equity(s.book, pricesFrom(s.tickers)));
}
