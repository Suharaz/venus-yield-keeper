import { formatEther, type Hash } from "viem";
import { clients, readVenus, type Clients, type VenusView } from "../shared/chain";
import { ADDR, vBnbAbi, type BaseEnv } from "../shared/config";
import { fmtBps } from "../shared/format";
import { activeHireCount, pushAction, syncHires, type ActionRecord, type HireBook } from "../shared/hires";
import type { AgentReport } from "../shared/worker";
import { decide, targetBps, type Decision, type StrategyParams } from "./strategy";

export interface YieldEnv extends BaseEnv {
  MIN_APY_BPS: string;
  BASE_TARGET_BPS: string;
  PER_HIRE_BPS: string;
  MAX_TARGET_BPS: string;
  BAND_BPS: string;
  GAS_RESERVE_WEI: string;
  HARVEST_MIN_WEI: string;
}

const STATE_KEY = "state";
/** A sent tx with no receipt after this long is treated as dropped. */
const PENDING_TIMEOUT_SEC = 600;

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

interface YieldState extends HireBook {
  principalWei: string;
  lastHarvestDay: string | null;
  pending: PendingAction | null;
}

const EMPTY_STATE: YieldState = { principalWei: "0", lastHarvestDay: null, lastSubId: 0, hires: {}, actions: [], pending: null };

async function loadState(env: YieldEnv): Promise<YieldState> {
  return (await env.STATE.get<YieldState>(STATE_KEY, "json")) ?? structuredClone(EMPTY_STATE);
}

function params(env: YieldEnv): StrategyParams {
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

async function execute(decision: Decision, market: VenusView, c: Clients): Promise<Hash | null> {
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

/**
 * Apply a sent Venus tx to principal once its receipt exists. Returns true while it is
 * still unconfirmed (caller must not start another action).
 */
async function settlePending(state: YieldState, c: Clients, nowSec: number): Promise<boolean> {
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

function snapshot(state: YieldState, market: VenusView, nowSec: number, jobHires: number) {
  return {
    apyBps: market.apyBps,
    walletWei: market.walletWei,
    suppliedWei: market.suppliedWei,
    principalWei: BigInt(state.principalWei),
    activeHires: activeHireCount(state, nowSec) + jobHires,
    today: new Date(nowSec * 1000).toISOString().slice(0, 10),
    lastHarvestDay: state.lastHarvestDay,
  };
}

/** One scheduled cycle: complete hires, then apply at most one yield action. State is saved even if a step throws. */
export async function runCycle(env: YieldEnv, jobHires: number): Promise<{ decision: Decision; txHash: Hash | null }> {
  const state = await loadState(env);
  const saveState = () => env.STATE.put(STATE_KEY, JSON.stringify(state));
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    try {
      await syncHires(env.LISTING_ID, state, c, nowSec);
    } catch (err) {
      console.error("hire sync failed", err);
    }

    if (await settlePending(state, c, nowSec)) {
      return { decision: { kind: "hold", targetWei: 0n, reason: `waiting for tx ${state.pending?.txHash}` }, txHash: null };
    }

    const market = await readVenus(c.publicClient, c.account.address);
    const snap = snapshot(state, market, nowSec, jobHires);
    let decision = decide(params(env), snap);
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
        day: snap.today,
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

export interface YieldReport extends AgentReport {
  market: string;
  apy: string;
  walletBnb: string;
  suppliedBnb: string;
  principalBnb: string;
  accruedInterestBnb: string;
  targetShare: string;
  mintPaused: boolean;
  redeemPaused: boolean;
  nextDecision: { kind: string; reason: string; targetBnb: string };
}

/** Read-only report used by the A2A endpoint, /status and the dashboard. */
export async function report(env: YieldEnv, jobHires: number): Promise<YieldReport> {
  const state = await loadState(env);
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const market = await readVenus(c.publicClient, c.account.address);
  const snap = snapshot(state, market, nowSec, jobHires);
  const preview = decide(params(env), snap);
  const supplied = market.suppliedWei;
  const principal = BigInt(state.principalWei);
  return {
    agentWallet: market.agentWallet,
    market: "Venus core pool vBNB (BSC testnet)",
    apy: fmtBps(market.apyBps),
    walletBnb: formatEther(market.walletWei),
    suppliedBnb: formatEther(supplied),
    principalBnb: formatEther(principal),
    accruedInterestBnb: formatEther(supplied > principal ? supplied - principal : 0n),
    targetShare: fmtBps(targetBps(params(env), snap)),
    mintPaused: market.mintPaused,
    redeemPaused: market.redeemPaused,
    activeHires: snap.activeHires,
    hiresTracked: Object.keys(state.hires).length,
    nextDecision: { kind: preview.kind, reason: preview.reason, targetBnb: formatEther(preview.targetWei) },
    pendingTx: state.pending?.txHash ?? null,
    recentActions: state.actions.slice(0, 20),
  };
}

export function summary(r: YieldReport): string {
  const last = r.recentActions[0];
  return (
    `Venus vBNB supply APY ${r.apy}. Supplied ${r.suppliedBnb} BNB (accrued ${r.accruedInterestBnb}), wallet ${r.walletBnb} BNB, ` +
    `${r.activeHires} active hire(s). Next: ${r.nextDecision.kind} - ${r.nextDecision.reason}.` +
    (last ? ` Last action: ${last.kind} ${last.amountBnb} BNB (${last.reason}) tx ${last.txHash}.` : " No actions yet.")
  );
}
