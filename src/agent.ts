import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  type Address,
  type Chain,
  type Hash,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { ADDR, BLOCKS_PER_YEAR, comptrollerAbi, fuguSubscriptionAbi, vBnbAbi, type Env } from "./config";
import { decide, type Decision, type StrategyParams } from "./strategy";

const STATE_KEY = "state";
const MAX_SUBS_PER_CYCLE = 25;
const MAX_ACTIONS_KEPT = 100;

export interface ActionRecord {
  at: string;
  kind: Decision["kind"] | "claim";
  amountBnb: string;
  reason: string;
  txHash: Hash;
  ok: boolean;
  apyBps?: string;
  suppliedBeforeBnb?: string;
  targetBnb?: string;
  subId?: string;
}

interface HireRecord {
  subscriber: Address;
  endsAt: number;
  depositedWei: string;
  done: boolean;
}

/** A Venus tx that was sent but whose effect on principal is not yet applied. */
interface PendingAction {
  txHash: Hash;
  kind: Exclude<Decision["kind"], "hold">;
  amountWei: string;
  vTokenBefore: string;
  day: string;
  sentAt: number;
  record: Omit<ActionRecord, "ok">;
}

interface AgentState {
  principalWei: string;
  lastHarvestDay: string | null;
  /** Highest FuguSubscription subId already scanned. */
  lastSubId: number;
  hires: Record<string, HireRecord>;
  actions: ActionRecord[];
  pending: PendingAction | null;
}

const EMPTY_STATE: AgentState = { principalWei: "0", lastHarvestDay: null, lastSubId: 0, hires: {}, actions: [], pending: null };
/** A sent tx with no receipt after this long is treated as dropped. */
const PENDING_TIMEOUT_SEC = 600;

async function loadState(env: Env): Promise<AgentState> {
  return (await env.STATE.get<AgentState>(STATE_KEY, "json")) ?? structuredClone(EMPTY_STATE);
}

interface Clients {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
}

function clients(env: Env): Clients {
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY as `0x${string}`);
  const transport = http(env.RPC_URL, { batch: true });
  const publicClient = createPublicClient({ chain: bscTestnet, transport, batch: { multicall: true } }) as PublicClient;
  const walletClient = createWalletClient({ chain: bscTestnet, transport, account });
  return { account, publicClient, walletClient };
}

export interface MarketView {
  agentWallet: Address;
  apyBps: bigint;
  walletWei: bigint;
  vTokenBalance: bigint;
  suppliedWei: bigint;
  mintPaused: boolean;
  redeemPaused: boolean;
}

async function readMarket(publicClient: PublicClient, agentWallet: Address): Promise<MarketView> {
  const [rate, vTokenBalance, exchangeRate, mintPaused, redeemPaused, walletWei] = await Promise.all([
    publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "supplyRatePerBlock" }),
    publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "balanceOf", args: [agentWallet] }),
    // exchangeRateStored only moves when someone touches the market; simulate exchangeRateCurrent so accrued interest is real.
    publicClient
      .simulateContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "exchangeRateCurrent", account: agentWallet })
      .then((r) => r.result),
    publicClient.readContract({ address: ADDR.venusComptroller, abi: comptrollerAbi, functionName: "actionPaused", args: [ADDR.vBNB, 0] }),
    publicClient.readContract({ address: ADDR.venusComptroller, abi: comptrollerAbi, functionName: "actionPaused", args: [ADDR.vBNB, 1] }),
    publicClient.getBalance({ address: agentWallet }),
  ]);
  return {
    agentWallet,
    // Simple annualisation of the per-block supply rate.
    apyBps: (rate * BLOCKS_PER_YEAR * 10_000n) / 10n ** 18n,
    walletWei,
    vTokenBalance,
    suppliedWei: (vTokenBalance * exchangeRate) / 10n ** 18n,
    mintPaused,
    redeemPaused,
  };
}

function params(env: Env): StrategyParams {
  return {
    minApyBps: BigInt(env.MIN_APY_BPS),
    baseTargetBps: BigInt(env.BASE_TARGET_BPS),
    perHireBps: BigInt(env.PER_HIRE_BPS),
    maxTargetBps: BigInt(env.MAX_TARGET_BPS),
    bandBps: BigInt(env.BAND_BPS),
    gasReserveWei: BigInt(env.GAS_RESERVE_WEI),
    harvestMinWei: BigInt(env.HARVEST_MIN_WEI),
  };
}

const activeHireCount = (state: AgentState, nowSec: number) =>
  Object.values(state.hires).filter((h) => !h.done && h.endsAt > nowSec).length;

/**
 * Track hires of our HelloFugu listing and complete finished ones with claim(subId)
 * (permissionless; pays the listing owner). A sub is complete once endsAt has passed
 * and claimed == deposited.
 */
async function syncHires(env: Env, state: AgentState, c: Clients, nowSec: number) {
  const listingId = env.LISTING_ID ? BigInt(env.LISTING_ID) : null;
  if (listingId === null) return;
  const { publicClient, walletClient, account } = c;
  const sub = { address: ADDR.fuguSubscription, abi: fuguSubscriptionAbi } as const;

  const count = Number(await publicClient.readContract({ ...sub, functionName: "subCount" }));
  const ids = Array.from({ length: Math.min(count - state.lastSubId, MAX_SUBS_PER_CYCLE) }, (_, i) => state.lastSubId + 1 + i);
  const subs = await Promise.all(ids.map((id) => publicClient.readContract({ ...sub, functionName: "getSub", args: [BigInt(id)] })));
  subs.forEach((s, i) => {
    if (s.listingId === listingId) {
      state.hires[ids[i]] = { subscriber: s.subscriber, endsAt: Number(s.endsAt), depositedWei: s.deposited.toString(), done: false };
    }
  });
  if (ids.length) state.lastSubId = ids[ids.length - 1];

  for (const [subId, hire] of Object.entries(state.hires)) {
    if (hire.done || hire.endsAt > nowSec) continue;
    const [current, claimable] = await Promise.all([
      publicClient.readContract({ ...sub, functionName: "getSub", args: [BigInt(subId)] }),
      publicClient.readContract({ ...sub, functionName: "claimable", args: [BigInt(subId)] }),
    ]);
    if (claimable > 0n) {
      const { request } = await publicClient.simulateContract({ ...sub, functionName: "claim", args: [BigInt(subId)], account });
      const txHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1_000 });
      pushAction(state, {
        at: new Date().toISOString(),
        kind: "claim",
        amountBnb: formatEther(claimable),
        reason: `hire #${subId} by ${hire.subscriber} ended: complete it by releasing escrow`,
        txHash,
        ok: receipt.status === "success",
        subId,
      });
      hire.done = receipt.status === "success" && current.claimed + claimable >= current.deposited;
    } else {
      hire.done = current.claimed >= current.deposited || current.cancelled;
    }
  }
}

async function execute(decision: Decision, market: MarketView, c: Clients): Promise<Hash | null> {
  const { publicClient, walletClient, account } = c;
  const v = { address: ADDR.vBNB, abi: vBnbAbi, account } as const;
  switch (decision.kind) {
    case "hold":
      return null;
    case "supply": {
      const { request } = await publicClient.simulateContract({ ...v, functionName: "mint", value: decision.amountWei });
      return walletClient.writeContract(request);
    }
    case "withdraw":
    case "harvest": {
      const { request } = await publicClient.simulateContract({ ...v, functionName: "redeemUnderlying", args: [decision.amountWei] });
      return walletClient.writeContract(request);
    }
    case "withdrawAll": {
      const { request } = await publicClient.simulateContract({ ...v, functionName: "redeem", args: [market.vTokenBalance] });
      return walletClient.writeContract(request);
    }
  }
}

function pushAction(state: AgentState, a: ActionRecord) {
  state.actions.unshift(a);
  state.actions.length = Math.min(state.actions.length, MAX_ACTIONS_KEPT);
}

/**
 * Apply a sent Venus tx to principal once its receipt exists. Returns true while it is
 * still unconfirmed (caller must not start another action).
 */
async function settlePending(state: AgentState, c: Clients, nowSec: number): Promise<boolean> {
  const p = state.pending;
  if (!p) return false;
  const receipt = await c.publicClient.getTransactionReceipt({ hash: p.txHash }).catch(() => null);
  if (!receipt && nowSec - p.sentAt < PENDING_TIMEOUT_SEC) return true;
  // Venus can soft-fail (Failure event, no revert): trust the vToken balance, not the status alone.
  const after = await c.publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "balanceOf", args: [c.account.address] });
  const ok = receipt?.status === "success" && after !== BigInt(p.vTokenBefore);
  if (ok) {
    const principal = BigInt(state.principalWei);
    const amountWei = BigInt(p.amountWei);
    if (p.kind === "supply") state.principalWei = (principal + amountWei).toString();
    if (p.kind === "withdraw") state.principalWei = (principal > amountWei ? principal - amountWei : 0n).toString();
    if (p.kind === "withdrawAll") state.principalWei = "0";
    if (p.kind === "harvest") state.lastHarvestDay = p.day;
  }
  pushAction(state, { ...p.record, ok });
  state.pending = null;
  return false;
}

/** One scheduled cycle: complete hires, then apply at most one yield action. State is saved even if a step throws. */
export async function runCycle(env: Env): Promise<{ decision: Decision; txHash: Hash | null }> {
  const state = await loadState(env);
  const saveState = () => env.STATE.put(STATE_KEY, JSON.stringify(state));
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);

  try {
    try {
      await syncHires(env, state, c, nowSec);
    } catch (err) {
      console.error("hire sync failed", err);
    }

    if (await settlePending(state, c, nowSec)) {
      return { decision: { kind: "hold", targetWei: 0n, reason: `waiting for tx ${state.pending?.txHash}` }, txHash: null };
    }

    const market = await readMarket(c.publicClient, c.account.address);
    let decision = decide(params(env), {
      apyBps: market.apyBps,
      walletWei: market.walletWei,
      suppliedWei: market.suppliedWei,
      principalWei: BigInt(state.principalWei),
      activeHires: activeHireCount(state, nowSec),
      today,
      lastHarvestDay: state.lastHarvestDay,
    });
    if ((decision.kind === "supply" && market.mintPaused) || (decision.kind !== "supply" && decision.kind !== "hold" && market.redeemPaused)) {
      decision = { kind: "hold", targetWei: decision.targetWei, reason: `Venus ${decision.kind} is paused on vBNB` };
    }

    const txHash = await execute(decision, market, c);
    if (txHash && decision.kind !== "hold") {
      const amountWei = decision.kind === "withdrawAll" ? market.suppliedWei : decision.amountWei;
      state.pending = {
        txHash,
        kind: decision.kind,
        amountWei: amountWei.toString(),
        vTokenBefore: market.vTokenBalance.toString(),
        day: today,
        sentAt: nowSec,
        record: {
          at: new Date().toISOString(),
          kind: decision.kind,
          amountBnb: formatEther(amountWei),
          reason: decision.reason,
          txHash,
          apyBps: market.apyBps.toString(),
          suppliedBeforeBnb: formatEther(market.suppliedWei),
          targetBnb: formatEther(decision.targetWei),
        },
      };
      await saveState(); // the tx is out: record it before anything else can throw
      try {
        await c.publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1_000 });
      } catch (err) {
        console.error("receipt wait failed; will settle next cycle", err);
      }
      await settlePending(state, c, Math.floor(Date.now() / 1000));
    }
    return { decision, txHash };
  } finally {
    await saveState();
  }
}

/** Read-only report used by the A2A endpoint and /status. */
export async function report(env: Env) {
  const state = await loadState(env);
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const market = await readMarket(c.publicClient, c.account.address);
  const preview = decide(params(env), {
    apyBps: market.apyBps,
    walletWei: market.walletWei,
    suppliedWei: market.suppliedWei,
    principalWei: BigInt(state.principalWei),
    activeHires: activeHireCount(state, nowSec),
    today: new Date().toISOString().slice(0, 10),
    lastHarvestDay: state.lastHarvestDay,
  });
  const supplied = market.suppliedWei;
  const principal = BigInt(state.principalWei);
  return {
    agentWallet: market.agentWallet,
    market: "Venus core pool vBNB (BSC testnet)",
    apy: `${(Number(market.apyBps) / 100).toFixed(2)}%`,
    walletBnb: formatEther(market.walletWei),
    suppliedBnb: formatEther(supplied),
    principalBnb: state.principalWei === "0" ? "0" : formatEther(principal),
    accruedInterestBnb: formatEther(supplied > principal ? supplied - principal : 0n),
    activeHires: activeHireCount(state, nowSec),
    hiresTracked: Object.keys(state.hires).length,
    nextDecision: { kind: preview.kind, reason: preview.reason, targetBnb: formatEther(preview.targetWei) },
    pendingTx: state.pending?.txHash ?? null,
    recentActions: state.actions.slice(0, 10),
  };
}
