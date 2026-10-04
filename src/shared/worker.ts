import type { Address, Hash } from "viem";
import { agentCard, registrationFile, type AgentProfile } from "./cards";
import { clients } from "./chain";
import { ADDR, CHAIN_ID, EXPLORER, identityRegistryAbi, REPO_URL, type BaseEnv } from "./config";
import { activeJobCount, checkJob, negotiate, syncJobs, type JobBook, type NegotiateRequest, type ProviderIdentity } from "./erc8183";
import type { ActionRecord } from "./hires";
import { loadDoc } from "./kv-doc";
import { renderPage } from "./page";
import type { PageLink, PageModel } from "./page-model";

/** Fields every agent report has; agents add their own. */
export interface AgentReport {
  agentWallet: Address;
  activeHires: number;
  hiresTracked: number;
  nextDecision: { kind: string; reason: string };
  pendingTx: Hash | null;
  recentActions: ActionRecord[];
}

export interface CycleResult {
  decision: { kind: string; reason: string };
  txHash: Hash | null;
}

/**
 * What an agent plugs into the shared Worker. `jobHires` = paid ERC-8183 jobs (Pokter and other
 * ERC-8183 buyers) still being served; agents count them as active hires next to HelloFugu hires.
 */
export interface AgentModule<E extends BaseEnv, R extends AgentReport> {
  profile: AgentProfile;
  runCycle(env: E, jobHires: number): Promise<CycleResult>;
  report(env: E, jobHires: number): Promise<R>;
  /** One-paragraph answer for A2A message/send. */
  summary(r: R): string;
  /** Agent-specific dashboard sections. */
  sections(r: R): Pick<PageModel, "metrics" | "gates" | "allocation">;
}

const JOBS_KEY = "jobs";
/** A2A skill ids the ERC-8183 buyers (Pokter, BNB Agent SDK) send in a data part. */
const NEGOTIATE_SKILLS = ["negotiate", "negotiate-erc8183-job"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { message?: { messageId?: string; contextId?: string; parts?: { kind?: string; data?: unknown }[] } };
}

interface SkillData extends NegotiateRequest {
  skill?: unknown;
  job_id?: unknown;
}

async function loadJobs(env: BaseEnv): Promise<JobBook> {
  return (await env.STATE.get<JobBook>(JOBS_KEY, "json")) ?? {};
}

function identity(profile: AgentProfile, env: BaseEnv, wallet: Address): ProviderIdentity {
  return { agentId: env.AGENT_ID, agentName: profile.name, wallet };
}

async function handleA2A<E extends BaseEnv, R extends AgentReport>(m: AgentModule<E, R>, request: Request, env: E) {
  let rpc: JsonRpcRequest;
  try {
    rpc = await request.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  if (rpc.method !== "message/send") {
    return json({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
  }
  const reply = (parts: unknown[]) =>
    json({
      jsonrpc: "2.0",
      id: rpc.id ?? null,
      result: { kind: "message", role: "agent", messageId: crypto.randomUUID(), contextId: rpc.params?.message?.contextId, parts },
    });

  const data = rpc.params?.message?.parts?.find((p) => p.data && typeof p.data === "object")?.data as SkillData | undefined;
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof data?.skill === "string" && NEGOTIATE_SKILLS.includes(data.skill)) {
    return reply([{ kind: "data", data: await negotiate(data, c, nowSec) }]);
  }
  if (data?.skill === "notify_funded") {
    const jobId = String(data.job_id ?? "");
    if (!/^\d+$/.test(jobId)) return reply([{ kind: "data", data: { status: "rejected", jobId, reason: "job_id must be an integer" } }]);
    const problem = await checkJob(BigInt(jobId), identity(m.profile, env, c.account.address), c, nowSec).catch((e: Error) => e.message);
    // Delivery runs in the next cron cycle (at most 5 minutes), the single writer of state and nonces.
    return reply([{ kind: "data", data: problem ? { status: "rejected", jobId, reason: problem } : { status: "accepted", jobId } }]);
  }

  const r = await m.report(env, activeJobCount(await loadJobs(env)));
  return reply([
    { kind: "text", text: m.summary(r) },
    { kind: "data", data: r },
  ]);
}

async function pageModel<E extends BaseEnv, R extends AgentReport>(m: AgentModule<E, R>, env: E, origin: string): Promise<PageModel> {
  const { publicClient } = clients(env);
  const [r, owner] = await Promise.all([
    loadJobs(env).then((jobs) => m.report(env, activeJobCount(jobs))),
    env.AGENT_ID
      ? publicClient.readContract({ address: ADDR.identityRegistry, abi: identityRegistryAbi, functionName: "ownerOf", args: [BigInt(env.AGENT_ID)] })
      : Promise.resolve(""),
  ]);
  const hireLinks: PageLink[] = env.AGENT_ID
    ? [
        { label: "HelloFugu", url: `https://app.hellofugu.xyz/agent/${CHAIN_ID}:${env.AGENT_ID}` },
        { label: "Pokter", url: `https://pokter.xyz/hire/${CHAIN_ID}/${env.AGENT_ID}` },
      ]
    : [];
  return {
    name: m.profile.name,
    tagline: m.profile.tagline,
    category: m.profile.category,
    description: m.profile.description,
    agentId: env.AGENT_ID || null,
    chainId: CHAIN_ID,
    owner,
    agentWallet: r.agentWallet,
    endpoint: origin,
    hireLinks,
    techLinks: [
      { label: "Agent card (A2A)", url: `${origin}/.well-known/agent-card.json` },
      { label: "ERC-8004 registration", url: `${origin}/.well-known/agent-registration.json` },
      { label: "Status JSON", url: `${origin}/status` },
      ...(env.AGENT_ID ? [{ label: "Identity NFT", url: `${EXPLORER}/token/${ADDR.identityRegistry}?a=${env.AGENT_ID}` }] : []),
      { label: "Source code", url: REPO_URL },
    ],
    ...m.sections(r),
    policy: m.profile.policy,
    nextDecision: r.nextDecision,
    actions: r.recentActions.map(({ at, kind, amountBnb, reason, txHash, ok }) => ({ at, kind, amountBnb, reason, txHash, ok })),
    updatedAt: new Date().toISOString(),
    explorerTxBase: `${EXPLORER}/tx/`,
    explorerAddressBase: `${EXPLORER}/address/`,
  };
}

/** Cron: serve ERC-8183 jobs first (deliver/settle), then the agent's own cycle. Sequential, so nonces never race. */
async function scheduledCycle<E extends BaseEnv, R extends AgentReport>(m: AgentModule<E, R>, env: E) {
  const doc = await loadDoc<JobBook>(env.STATE, JOBS_KEY, {});
  const jobs = doc.value;
  try {
    const c = clients(env);
    await syncJobs(jobs, identity(m.profile, env, c.account.address), c, env.STATE, env.PUBLIC_URL, Math.floor(Date.now() / 1000), async (task) => {
      const r = await m.report(env, activeJobCount(jobs));
      return { agent: m.profile.name, agentId: env.AGENT_ID, chainId: CHAIN_ID, task, answer: m.summary(r), report: r };
    });
  } catch (err) {
    console.error("job sync failed", err);
  } finally {
    await doc.save(); // only when a job or the cursor changed
  }
  return m.runCycle(env, activeJobCount(jobs));
}

/** Worker handler shared by all agents: cards, A2A (+ ERC-8183 quotes), status JSON, HTML dashboard, deliverables, cron. */
export function createWorker<E extends BaseEnv, R extends AgentReport>(m: AgentModule<E, R>): ExportedHandler<E> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const origin = url.origin;
      const deliverable = url.pathname.match(/^\/deliverables\/(\d+)$/);
      if (request.method === "GET" && deliverable) {
        const text = await env.STATE.get(`deliverable:${deliverable[1]}`);
        return text === null ? json({ error: "not found" }, 404) : new Response(text, { headers: { "content-type": "application/json" } });
      }
      switch (`${request.method} ${url.pathname}`) {
        case "GET /.well-known/agent-card.json":
          return json(agentCard(m.profile, origin));
        case "GET /.well-known/agent-registration.json":
          return json(registrationFile(m.profile, origin, env));
        case "GET /icon.svg":
          return new Response(m.profile.iconSvg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
        case "GET /health":
          return json({ ok: true });
        case "GET /":
          if (request.headers.get("accept")?.includes("text/html")) {
            return new Response(renderPage(await pageModel(m, env, origin)), { headers: { "content-type": "text/html; charset=utf-8" } });
          }
          return json(await m.report(env, activeJobCount(await loadJobs(env))));
        case "GET /status":
          return json(await m.report(env, activeJobCount(await loadJobs(env))));
        case "GET /jobs":
          return json(await loadJobs(env));
        case "POST /":
        case "POST /a2a":
          return handleA2A(m, request, env);
        default:
          return json({ error: "not found" }, 404);
      }
    },

    async scheduled(_controller, env, ctx) {
      ctx.waitUntil(
        scheduledCycle(m, env).then(
          ({ decision, txHash }) => console.log("cycle", decision.kind, decision.reason, txHash ?? ""),
          (err) => console.error("cycle failed", err),
        ),
      );
    },
  };
}
