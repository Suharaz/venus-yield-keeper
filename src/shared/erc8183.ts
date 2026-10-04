/**
 * ERC-8183 (agentic commerce) provider side, as used by Pokter and BNB Agent SDK buyers on BSC testnet:
 *   negotiate      -> signed price quote (EIP-191 over the canonical-JSON hash, by the agent wallet)
 *   notify_funded  -> quick validation answer; the cron does the work
 *   cron           -> find FUNDED jobs for our wallet, deliver a manifest (submit), settle after the dispute window
 * The deliverable text is stored in KV before submit and served byte-for-byte at /deliverables/:jobId.
 */
import { getAddress, isAddressEqual, keccak256, parseAbi, recoverMessageAddress, toBytes, toHex, type Address, type Hash } from "viem";
import type { Clients } from "./chain";
import { CHAIN_ID } from "./config";

export const COMMERCE = {
  commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
  router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
  policy: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
  /** $U payment token (18 decimals). */
  token: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
} as const satisfies Record<string, Address>;

export const commerceAbi = parseAbi([
  "struct Job { uint256 id; address client; address provider; address evaluator; string description; uint256 budget; uint256 expiredAt; uint8 status; address hook; uint256 submittedAt; bytes32 deliverable; }",
  "function getJob(uint256 jobId) view returns (Job)",
  "function jobCounter() view returns (uint256)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "error WrongStatus()",
  "error Unauthorized()",
  "error InvalidJob()",
  "error HookCallFailed()",
  "error EnforcedPause()",
]);
const routerAbi = parseAbi([
  "function settle(uint256 jobId, bytes evidence)",
  "error NotDecided()",
  "error PolicyNotSet()",
  "error JobNotOpen()",
  "error PolicyNotWhitelisted()",
]);
const policyAbi = parseAbi([
  "function disputeWindow() view returns (uint64)",
  "function disputed(uint256 jobId) view returns (bool)",
  "error SubmissionTooLate()",
  "error OutsideDisputeWindow()",
  "error NotSubmitted()",
  "error WrongJobStatus()",
]);

/** Onchain JobStatus enum. */
const STATUS = ["open", "funded", "submitted", "completed", "rejected", "expired"] as const;
type JobStatus = (typeof STATUS)[number];

/** Quote price: 0.1 $U per job (Pokter's budget control accepts 0.01 to 5 U). */
const PRICE_WEI = 100_000_000_000_000_000n;
const QUOTE_TTL_SEC = 3 * 3600;
/** First run looks back this many job ids; later runs continue from the cursor. */
const JOB_LOOKBACK = 30;
const MAX_JOBS_PER_CYCLE = 40;
const SETTLE_MARGIN_SEC = 30;

export interface JobRecord {
  client: Address;
  budgetWei: string;
  expiredAt: number;
  status: JobStatus | "refused";
  task: string;
  reason?: string;
  submittedAt?: number;
  deliverable?: Hash;
  submitTx?: Hash;
  settleTx?: Hash;
}

export interface JobBook {
  /** Highest commerce jobId already scanned (0 = not started). */
  lastJobId?: number;
  jobs?: Record<string, JobRecord>;
}

export interface ProviderIdentity {
  agentId: string;
  agentName: string;
  wallet: Address;
}

/** Canonical JSON (sorted keys, compact, non-ASCII as \uXXXX): byte-identical to the BNB Agent SDK / Python json.dumps. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value)).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const sanitize = (s: string) => s.replace(/\[/g, "(").replace(/\]/g, ")").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

export interface NegotiateRequest {
  task_description?: unknown;
  terms?: { deliverables?: unknown; quality_standards?: unknown; success_criteria?: unknown };
}

/** Signed quote in the BNB Agent SDK NegotiationResult shape (what Pokter's sweep and hire form read). */
export async function negotiate(req: NegotiateRequest, c: Clients, nowSec: number) {
  const task = sanitize(typeof req.task_description === "string" ? req.task_description : "Standard report");
  const deliverables = sanitize(typeof req.terms?.deliverables === "string" ? req.terms.deliverables : "A JSON report of the agent's live position, policy decision and recent onchain actions.");
  const quality = sanitize(typeof req.terms?.quality_standards === "string" ? req.terms.quality_standards : "Figures read from chain at delivery time; no funds of the buyer are moved.");
  const terms = { deliverables, quality_standards: quality, evaluation_required: true, evaluator_type: "uma_oov3" };
  const quoteExpiresAt = nowSec + QUOTE_TTL_SEC;
  const content = {
    version: 1,
    negotiated_at: nowSec,
    task,
    terms: { deliverables, quality_standards: quality },
    price: PRICE_WEI.toString(),
    currency: COMMERCE.token,
    quote_expires_at: quoteExpiresAt,
    chain_id: CHAIN_ID,
    verifying_contract: getAddress(COMMERCE.commerce),
  };
  const negotiationHash = keccak256(toBytes(canonicalJson(content)));
  const request = { task_description: task, terms };
  const response = {
    accepted: true,
    terms: { ...terms, price: PRICE_WEI.toString(), currency: COMMERCE.token },
    estimated_completion_seconds: 300,
    quote_expires_at: quoteExpiresAt,
    negotiated_at: nowSec,
  };
  return {
    request,
    request_hash: keccak256(toBytes(canonicalJson(request))),
    response,
    response_hash: keccak256(toBytes(canonicalJson({ accepted: true, terms: response.terms, estimated_completion_seconds: 300, quote_expires_at: quoteExpiresAt }))),
    negotiation_hash: negotiationHash,
    provider_sig: await c.account.signMessage({ message: negotiationHash }),
    chain_id: CHAIN_ID,
    verifying_contract: getAddress(COMMERCE.commerce),
    provider_address: c.account.address,
  };
}

/** Why a job description does not name us, or null when it does (Pokter envelope or a quote signed by us). */
async function descriptionMismatch(description: string, me: ProviderIdentity): Promise<string | null> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(description);
  } catch {
    return "description is not JSON";
  }
  if (parsed.protocol === "pokter-job") {
    const identity = parsed.identity as { chainId?: unknown; tokenId?: unknown } | undefined;
    if (typeof parsed.provider !== "string" || !isAddressEqual(parsed.provider as Address, me.wallet)) return "envelope names another provider";
    if (identity?.chainId !== CHAIN_ID || identity?.tokenId !== me.agentId) return "envelope names another agent";
    return null;
  }
  if (typeof parsed.negotiation_hash === "string" && typeof parsed.provider_sig === "string") {
    const signer = await recoverMessageAddress({ message: parsed.negotiation_hash, signature: parsed.provider_sig as Hash }).catch(() => null);
    return signer && isAddressEqual(signer, me.wallet) ? null : "quote not signed by this agent";
  }
  return "unknown job description format";
}

const taskOf = (description: string) => {
  try {
    const d = JSON.parse(description) as { task?: unknown; task_description?: unknown };
    return String(d.task ?? d.task_description ?? "");
  } catch {
    return description.slice(0, 500);
  }
};

/** Validation used by notify_funded and the cron. Returns null when the job may be worked on. */
export async function checkJob(jobId: bigint, me: ProviderIdentity, c: Clients, nowSec: number): Promise<string | null> {
  const [job, window] = await Promise.all([
    c.publicClient.readContract({ address: COMMERCE.commerce, abi: commerceAbi, functionName: "getJob", args: [jobId] }),
    c.publicClient.readContract({ address: COMMERCE.policy, abi: policyAbi, functionName: "disputeWindow" }),
  ]);
  if (!isAddressEqual(job.provider, me.wallet)) return "job provider is not this agent";
  if (STATUS[job.status] !== "funded") return `job is ${STATUS[job.status] ?? job.status}, not funded`;
  if (job.budget === 0n) return "job has no budget";
  if (BigInt(nowSec) >= job.expiredAt - window) return "too close to expiry to deliver and settle";
  return descriptionMismatch(job.description, me);
}

/**
 * Track jobs addressed to our wallet, deliver funded ones and settle submitted ones after the dispute window.
 * `produce` returns the JSON result for a task. Runs inside the cron only (one writer of state and nonces).
 */
export async function syncJobs(
  book: JobBook,
  me: ProviderIdentity,
  c: Clients,
  kv: KVNamespace,
  publicUrl: string,
  nowSec: number,
  produce: (task: string) => Promise<unknown>,
) {
  if (!me.agentId) return;
  const { publicClient, walletClient, account } = c;
  const commerce = { address: COMMERCE.commerce, abi: commerceAbi } as const;
  book.jobs ??= {};
  const jobs = book.jobs;

  const counter = Number(await publicClient.readContract({ ...commerce, functionName: "jobCounter" }));
  const from = book.lastJobId ?? Math.max(0, counter - JOB_LOOKBACK);
  const ids = Array.from({ length: Math.min(counter - from, MAX_JOBS_PER_CYCLE) }, (_, i) => from + 1 + i);
  const fresh = await Promise.all(ids.map((id) => publicClient.readContract({ ...commerce, functionName: "getJob", args: [BigInt(id)] })));
  fresh.forEach((j, i) => {
    if (isAddressEqual(j.provider, account.address)) {
      jobs[ids[i]] = { client: j.client, budgetWei: j.budget.toString(), expiredAt: Number(j.expiredAt), status: STATUS[j.status], task: taskOf(j.description) };
    }
  });
  if (ids.length) book.lastJobId = ids[ids.length - 1];

  const window = Number(await publicClient.readContract({ address: COMMERCE.policy, abi: policyAbi, functionName: "disputeWindow" }));
  for (const [id, rec] of Object.entries(jobs)) {
    if (rec.status === "completed" || rec.status === "rejected" || rec.status === "expired" || rec.status === "refused") continue;
    try {
      await advanceJob(BigInt(id), rec, { me, c, kv, publicUrl, nowSec, window, produce });
    } catch (err) {
      console.error(`job ${id} step failed; retry next cycle`, err);
    }
  }
}

interface JobContext {
  me: ProviderIdentity;
  c: Clients;
  kv: KVNamespace;
  publicUrl: string;
  nowSec: number;
  window: number;
  produce: (task: string) => Promise<unknown>;
}

/** Move one job forward: funded -> submitted (deliver), submitted -> completed (settle). */
async function advanceJob(jobId: bigint, rec: JobRecord, x: JobContext) {
  const { publicClient, walletClient, account } = x.c;
  const commerce = { address: COMMERCE.commerce, abi: commerceAbi } as const;
  const job = await publicClient.readContract({ ...commerce, functionName: "getJob", args: [jobId] });
  rec.status = STATUS[job.status];
  rec.budgetWei = job.budget.toString();

  if (rec.status === "funded") {
    const problem = await checkJob(jobId, x.me, x.c, x.nowSec);
    if (problem) {
      // Not ours to deliver: leave it for the client's refund. "Too close to expiry" can still change, so keep watching.
      if (!problem.startsWith("too close")) rec.status = "refused";
      rec.reason = problem;
      return;
    }
    // Reuse stored text: a submit whose receipt was lost may still land with the hash of the first text.
    const key = `deliverable:${jobId}`;
    let text = await x.kv.get(key);
    if (!text) {
      const manifest = {
        version: 1,
        job_id: Number(jobId),
        chain_id: CHAIN_ID,
        contracts: { commerce: COMMERCE.commerce, router: COMMERCE.router, policy: COMMERCE.policy },
        response: { content: JSON.stringify(await x.produce(rec.task)), content_type: "application/json" },
        metadata: { producer: `${x.me.agentName} (ERC-8004 ${CHAIN_ID}:${x.me.agentId})`, generated_at: new Date(x.nowSec * 1000).toISOString() },
      };
      text = canonicalJson(manifest);
      await x.kv.put(key, text); // must be fetchable before the hash goes onchain
    }
    const deliverable = keccak256(toHex(text));
    const optParams = toHex(JSON.stringify({ deliverable_url: `${x.publicUrl}/deliverables/${jobId}` }));
    const { request } = await publicClient.simulateContract({ ...commerce, functionName: "submit", args: [jobId, deliverable, optParams], account });
    const tx = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, pollingInterval: 1_000 });
    if (receipt.status === "success") Object.assign(rec, { status: "submitted", submittedAt: x.nowSec, deliverable, submitTx: tx });
    return;
  }

  if (rec.status === "submitted") {
    const submittedAt = Number(job.submittedAt) || rec.submittedAt || x.nowSec;
    if (x.nowSec < submittedAt + x.window + SETTLE_MARGIN_SEC || x.nowSec >= rec.expiredAt) return;
    const disputed = await publicClient.readContract({ address: COMMERCE.policy, abi: policyAbi, functionName: "disputed", args: [jobId] });
    if (disputed) return;
    const { request } = await publicClient.simulateContract({ address: COMMERCE.router, abi: routerAbi, functionName: "settle", args: [jobId, "0x"], account });
    const tx = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash: tx, pollingInterval: 1_000 });
    const after = await publicClient.readContract({ ...commerce, functionName: "getJob", args: [jobId] });
    rec.status = STATUS[after.status];
    rec.settleTx = tx;
  }
}

/** Jobs that are paid for and still being served count as active hires. */
export function activeJobCount(book: JobBook): number {
  return Object.values(book.jobs ?? {}).filter((j) => j.status === "funded" || j.status === "submitted").length;
}
