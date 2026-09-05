import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

/** Dev-only /api/agent → xAI Grok. Requires XAI_API_KEY in the environment. */
function agentApiPlugin(): Plugin {
  return {
    name: "aether-agent-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/api/agent" || req.method !== "POST") {
          next();
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString("utf8");

        try {
          const apiKey = process.env.XAI_API_KEY;
          if (!apiKey) {
            res.statusCode = 503;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: "XAI_API_KEY is not set on the server." }));
            return;
          }

          const input = JSON.parse(body) as {
            message: string;
            cash: number;
            equity: number;
            positions: Array<{ symbol: string; qty: number; avgCost: number; last: number }>;
            tape: Array<{ symbol: string; last: number; changePct: number; bid: number; ask: number }>;
            selected: string;
            history: Array<{ role: "user" | "agent"; text: string }>;
          };

          const universe =
            "BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, DOTUSDT, LTCUSDT, UNIUSDT";

          const system = `You are Aether, the desk agent on a PAPER trading terminal marked to the live Binance USDT spot tape. Nothing here is live capital. You never claim a fill happened. You only propose orders; the trader approves.

Voice: terse, institutional, no hype, no emoji, no exclamation. Short sentences.

Universe only: ${universe}. Always emit symbol as the Binance pair (e.g. BTCUSDT).

Sizing:
- Qty is base asset amount, not USDT.
- Each proposal notional should be 3–12% of current equity unless the trader specifies size.
- Never propose a buy larger than cash. Never propose a sell larger than the position.
- Max 3 proposals. If the trader is asking a question, proposals may be empty.
- This is not financial advice; it is a paper desk note on public Binance prints.`;

          const snapshot = {
            selected: input.selected,
            cashUsdt: Number(input.cash.toFixed(2)),
            equityUsdt: Number(input.equity.toFixed(2)),
            positions: input.positions,
            tape: input.tape,
          };

          const messages = [
            { role: "system", content: system },
            ...input.history.slice(-6).map((h) => ({
              role: h.role === "agent" ? "assistant" : "user",
              content: h.text.slice(0, 1200),
            })),
            {
              role: "user",
              content: `${input.message.slice(0, 2000)}\n\nBOOK_AND_TAPE:\n${JSON.stringify(snapshot)}`,
            },
          ];

          const schema = {
            type: "json_schema",
            json_schema: {
              name: "desk_note",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  brief: { type: "string" },
                  stance: {
                    type: "string",
                    enum: ["bullish", "bearish", "neutral", "mixed"],
                  },
                  proposals: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        action: { type: "string", enum: ["buy", "sell"] },
                        symbol: { type: "string" },
                        qty: { type: "number" },
                        rationale: { type: "string" },
                        confidence: { type: "number" },
                      },
                      required: ["action", "symbol", "qty", "rationale", "confidence"],
                    },
                  },
                },
                required: ["brief", "stance", "proposals"],
              },
            },
          };

          const xr = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "grok-4.5",
              messages,
              max_tokens: 700,
              temperature: 0.4,
              response_format: schema,
            }),
          });

          if (!xr.ok) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: `xAI API error ${xr.status}` }));
            return;
          }

          const data = (await xr.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = data.choices?.[0]?.message?.content ?? "";
          const parsed = JSON.parse(text) as {
            brief?: string;
            stance?: string;
            proposals?: Array<{
              action: string;
              symbol: string;
              qty: number;
              rationale: string;
              confidence: number;
            }>;
          };

          const allowed = new Set([
            "BTCUSDT",
            "ETHUSDT",
            "SOLUSDT",
            "BNBUSDT",
            "XRPUSDT",
            "DOGEUSDT",
            "ADAUSDT",
            "AVAXUSDT",
            "LINKUSDT",
            "DOTUSDT",
            "LTCUSDT",
            "UNIUSDT",
          ]);

          const proposals = (parsed.proposals ?? [])
            .slice(0, 3)
            .map((p) => {
              const sym = String(p.symbol ?? "")
                .toUpperCase()
                .replace(/[-_/]/g, "");
              const symbol = allowed.has(sym)
                ? sym
                : allowed.has(`${sym}USDT`)
                  ? `${sym}USDT`
                  : null;
              if (!symbol) return null;
              const qty = Number(p.qty);
              if (!Number.isFinite(qty) || qty <= 0) return null;
              return {
                action: p.action === "sell" ? "sell" : "buy",
                symbol,
                qty,
                rationale: String(p.rationale ?? "").slice(0, 280),
                confidence: Math.min(1, Math.max(0, Number(p.confidence) || 0)),
              };
            })
            .filter(Boolean);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: true,
              brief: (parsed.brief ?? "").trim() || "No desk note.",
              stance: ["bullish", "bearish", "neutral", "mixed"].includes(parsed.stance ?? "")
                ? parsed.stance
                : "neutral",
              proposals,
            }),
          );
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Agent failed",
            }),
          );
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), agentApiPlugin()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/binance": {
        target: "https://data-api.binance.vision",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/binance/, ""),
      },
    },
  },
});
