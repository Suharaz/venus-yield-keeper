import { report, runCycle } from "./agent";
import { agentCard, ICON_SVG, registrationFile } from "./cards";
import type { Env } from "./config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { message?: { messageId?: string; contextId?: string } };
}

/** A2A JSON-RPC: message/send answers with the live position report. */
async function handleA2A(request: Request, env: Env): Promise<Response> {
  let rpc: JsonRpcRequest;
  try {
    rpc = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  if (rpc.method !== "message/send") {
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
  }
  const r = await report(env);
  const last = r.recentActions[0];
  const text =
    `Venus vBNB supply APY ${r.apy}. Supplied ${r.suppliedBnb} BNB (accrued ${r.accruedInterestBnb}), wallet ${r.walletBnb} BNB, ` +
    `${r.activeHires} active hire(s). Next: ${r.nextDecision.kind} - ${r.nextDecision.reason}.` +
    (last ? ` Last action: ${last.kind} ${last.amountBnb} BNB (${last.reason}) tx ${last.txHash}.` : " No actions yet.");
  return json({
    jsonrpc: "2.0",
    id: rpc.id ?? null,
    result: {
      kind: "message",
      role: "agent",
      messageId: crypto.randomUUID(),
      contextId: rpc.params?.message?.contextId,
      parts: [
        { kind: "text", text },
        { kind: "data", data: r },
      ],
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    switch (`${request.method} ${url.pathname}`) {
      case "GET /.well-known/agent-card.json":
        return json(agentCard(origin));
      case "GET /.well-known/agent-registration.json":
        return json(registrationFile(origin, env));
      case "GET /icon.svg":
        return new Response(ICON_SVG, { headers: { "content-type": "image/svg+xml" } });
      case "GET /health":
        return json({ ok: true });
      case "GET /":
      case "GET /status":
        return json(await report(env));
      case "POST /":
      case "POST /a2a":
        return handleA2A(request, env);
      default:
        return json({ error: "not found" }, 404);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runCycle(env).then(
        ({ decision, txHash }) => console.log("cycle", decision.kind, decision.reason, txHash ?? ""),
        (err) => console.error("cycle failed", err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
