import { formatEther, isAddress, type Hash } from "viem";
import { clients, readVenus, type Clients, type VenusView } from "../shared/chain";
import { ADDR, vBnbAbi, type BaseEnv } from "../shared/config";
import { fmtBps } from "../shared/format";
import { activeHireCount, pushAction, syncHires, type ActionRecord, type HireBook } from "../shared/hires";
import { loadDoc } from "../shared/kv-doc";
import type { AgentReport } from "../shared/worker";
import { dailyOutflowWei, decideTreasury, reserveTargetWei, type Payee, type TreasuryDecision, type TreasuryParams } from "./policy";

export interface TreasuryEnv extends BaseEnv {
  FLOOR_WEI: string;
  RUNWAY_DAYS: string;
  PER_HIRE_RESERVE_WEI: string;
  BAND_BPS: string;
  MIN_APY_BPS: string;
  /** JSON array of { label, to, amountWei }: payees paid once per UTC day. */
  PAYEES: string;
}

const STATE_KEY = "state";
/** A tx unknown to the node after this long, with its nonce unused, is treated as dropped. */
const DROP_AFTER_SEC = 180;
const PAYOUT_HISTORY_DAYS = 60;

type ActionKind = Exclude<TreasuryDecision["kind"], "hold">;

interface PendingTx {
  txHash: Hash;
  nonce: number;
  kind: ActionKind;
  amountWei: string;
  payoutKey: string | null;
  vTokenBefore: string;
  sentAt: number;
  record: Omit<ActionRecord, "ok">;
}

interface TreasuryState extends HireBook {
  /** BNB moved into Venus minus BNB moved out (interest excluded). */
  principalWei: string;
  /** payoutKey ("YYYY-MM-DD:index") -> tx hash, for every payout that succeeded. */
  paid: Record<string, Hash>;
  pending: PendingTx | null;
}

const EMPTY_STATE: TreasuryState = { principalWei: "0", paid: {}, lastSubId: 0, hires: {}, actions: [], pending: null };

async function loadState(env: TreasuryEnv): Promise<TreasuryState> {
  return (await env.STATE.get<TreasuryState>(STATE_KEY, "json")) ?? structuredClone(EMPTY_STATE);
}

function parsePayees(raw: string): Payee[] {
  const list = JSON.parse(raw || "[]") as { label: string; to: string; amountWei: string }[];
  return list.map(({ label, to, amountWei }) => {
    if (!isAddress(to)) throw new Error(`PAYEES: bad address ${to}`);
    return { label, to, amountWei: BigInt(amountWei) };
  });
}

function params(env: TreasuryEnv): TreasuryParams {
  return {
    floorWei: BigInt(env.FLOOR_WEI),
    runwayDays: BigInt(env.RUNWAY_DAYS),
    perHireReserveWei: BigInt(env.PER_HIRE_RESERVE_WEI),
    bandBps: BigInt(env.BAND_BPS),
    minApyBps: BigInt(env.MIN_APY_BPS),
    payees: parsePayees(env.PAYEES),
  };
}

function snapshot(state: TreasuryState, v: VenusView, nowSec: number, jobHires: number) {
  return {
    apyBps: v.apyBps,
    liquidWei: v.walletWei,
    suppliedWei: v.suppliedWei,
    activeHires: activeHireCount(state, nowSec) + jobHires,
    today: new Date(nowSec * 1000).toISOString().slice(0, 10),
    paid: state.paid,
    mintPaused: v.mintPaused,
    redeemPaused: v.redeemPaused,
  };
}

async function execute(d: Exclude<TreasuryDecision, { kind: "hold" }>, v: VenusView, c: Clients, nonce: number): Promise<Hash> {
  const { publicClient, walletClient, account } = c;
  const vbnb = { address: ADDR.vBNB, abi: vBnbAbi, account, nonce } as const;
  switch (d.kind) {
    case "payout":
      return walletClient.sendTransaction({ to: d.to, value: d.amountWei, nonce });
    case "sweep": {
      const { request } = await publicClient.simulateContract({ ...vbnb, functionName: "mint", value: d.amountWei });
      return walletClient.writeContract(request);
    }
    case "topUp": {
      const { request } = await publicClient.simulateContract({ ...vbnb, functionName: "redeemUnderlying", args: [d.amountWei] });
      return walletClient.writeContract(request);
    }
    case "exitVenus": {
      const { request } = await publicClient.simulateContract({ ...vbnb, functionName: "redeem", args: [v.vTokenBalance] });
      return walletClient.writeContract(request);
    }
  }
}

/**
 * Resolve the in-flight tx. Returns true while it may still land (caller must not act).
 * A tx counts as dropped only when the node no longer knows it AND its nonce is still
 * unused, so a slow payout is never sent twice.
 */
async function settlePending(state: TreasuryState, c: Clients, nowSec: number): Promise<boolean> {
  const p = state.pending;
  if (!p) return false;
  const { publicClient, account } = c;
  const receipt = await publicClient.getTransactionReceipt({ hash: p.txHash }).catch(() => null);
  if (!receipt) {
    if (nowSec - p.sentAt < DROP_AFTER_SEC) return true;
    const [known, nextNonce] = await Promise.all([
      publicClient.getTransaction({ hash: p.txHash }).then(() => true).catch(() => false),
      publicClient.getTransactionCount({ address: account.address, blockTag: "latest" }),
    ]);
    if (known || nextNonce > p.nonce) return true;
  }
  let ok = receipt?.status === "success";
  if (ok && p.kind !== "payout") {
    // Venus can soft-fail (Failure event, no revert): trust the vToken balance, not the status alone.
    const after = await publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "balanceOf", args: [account.address] });
    ok = after !== BigInt(p.vTokenBefore);
  }
  if (ok) {
    const principal = BigInt(state.principalWei);
    const amount = BigInt(p.amountWei);
    if (p.kind === "sweep") state.principalWei = (principal + amount).toString();
    if (p.kind === "topUp") state.principalWei = (principal > amount ? principal - amount : 0n).toString();
    if (p.kind === "exitVenus") state.principalWei = "0";
    if (p.kind === "payout" && p.payoutKey) state.paid[p.payoutKey] = p.txHash;
  }
  pushAction(state, { ...p.record, ok });
  state.pending = null;
  return false;
}

function prunePaid(state: TreasuryState, nowSec: number) {
  const oldest = new Date((nowSec - PAYOUT_HISTORY_DAYS * 86_400) * 1000).toISOString().slice(0, 10);
  for (const key of Object.keys(state.paid)) if (key.slice(0, 10) < oldest) delete state.paid[key];
}

/** One scheduled cycle: complete hires, settle the last tx, then take at most one treasury action. */
export async function runCycle(env: TreasuryEnv, jobHires: number): Promise<{ decision: TreasuryDecision; txHash: Hash | null }> {
  const doc = await loadDoc(env.STATE, STATE_KEY, EMPTY_STATE);
  const state = doc.value;
  const saveState = doc.save; // writes only when the state changed (hold cycles cost no KV write)
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    try {
      await syncHires(env.LISTING_ID, state, c, nowSec);
    } catch (err) {
      console.error("hire sync failed", err);
    }
    prunePaid(state, nowSec);

    if (await settlePending(state, c, nowSec)) {
      return { decision: { kind: "hold", reserveTargetWei: 0n, reason: `waiting for tx ${state.pending?.txHash}` }, txHash: null };
    }

    const [v, nonce] = await Promise.all([
      readVenus(c.publicClient, c.account.address),
      c.publicClient.getTransactionCount({ address: c.account.address, blockTag: "pending" }),
    ]);
    const decision = decideTreasury(params(env), snapshot(state, v, nowSec, jobHires));
    if (decision.kind === "hold") return { decision, txHash: null };

    const txHash = await execute(decision, v, c, nonce);
    const amountWei = decision.kind === "exitVenus" ? v.suppliedWei : decision.amountWei;
    state.pending = {
      txHash,
      nonce,
      kind: decision.kind,
      amountWei: amountWei.toString(),
      payoutKey: decision.kind === "payout" ? decision.payoutKey : null,
      vTokenBefore: v.vTokenBalance.toString(),
      sentAt: nowSec,
      record: {
        at: new Date().toISOString(),
        kind: decision.kind,
        amountBnb: formatEther(amountWei),
        reason: decision.reason,
        txHash,
        ...(decision.kind === "payout" ? { to: decision.to, payoutKey: decision.payoutKey } : {}),
        liquidBeforeBnb: formatEther(v.walletWei),
        suppliedBeforeBnb: formatEther(v.suppliedWei),
        reserveTargetBnb: formatEther(decision.reserveTargetWei),
        apyBps: v.apyBps.toString(),
      },
    };
    await saveState(); // the tx is out: record it before anything else can throw
    try {
      await c.publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1_000 });
    } catch (err) {
      console.error("receipt wait failed; will settle next cycle", err);
    }
    await settlePending(state, c, Math.floor(Date.now() / 1000));
    return { decision, txHash };
  } finally {
    await saveState();
  }
}

export interface TreasuryReport extends AgentReport {
  venusApy: string;
  liquidBnb: string;
  suppliedBnb: string;
  accruedInterestBnb: string;
  totalBnb: string;
  reserveTargetBnb: string;
  dailyOutflowBnb: string;
  /** Days of scheduled payouts the liquid balance covers (above the floor). */
  runwayDays: string;
  payees: { label: string; to: string; amountBnb: string; paidToday: Hash | null }[];
  mintPaused: boolean;
  redeemPaused: boolean;
}

export async function report(env: TreasuryEnv, jobHires: number): Promise<TreasuryReport> {
  const state = await loadState(env);
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const p = params(env);
  const v = await readVenus(c.publicClient, c.account.address);
  const snap = snapshot(state, v, nowSec, jobHires);
  const preview = decideTreasury(p, snap);
  const principal = BigInt(state.principalWei);
  const outflow = dailyOutflowWei(p);
  const spendable = v.walletWei > p.floorWei ? v.walletWei - p.floorWei : 0n;
  return {
    agentWallet: v.agentWallet,
    venusApy: fmtBps(v.apyBps),
    liquidBnb: formatEther(v.walletWei),
    suppliedBnb: formatEther(v.suppliedWei),
    accruedInterestBnb: formatEther(v.suppliedWei > principal ? v.suppliedWei - principal : 0n),
    totalBnb: formatEther(v.walletWei + v.suppliedWei),
    reserveTargetBnb: formatEther(reserveTargetWei(p, snap.activeHires)),
    dailyOutflowBnb: formatEther(outflow),
    runwayDays: outflow === 0n ? "unlimited" : (Number(spendable + v.suppliedWei) / Number(outflow)).toFixed(1),
    payees: p.payees.map((x, i) => ({
      label: x.label,
      to: x.to,
      amountBnb: formatEther(x.amountWei),
      paidToday: state.paid[`${snap.today}:${i}`] ?? null,
    })),
    mintPaused: v.mintPaused,
    redeemPaused: v.redeemPaused,
    activeHires: snap.activeHires,
    hiresTracked: Object.keys(state.hires).length,
    nextDecision: { kind: preview.kind, reason: preview.reason },
    pendingTx: state.pending?.txHash ?? null,
    recentActions: state.actions.slice(0, 20),
  };
}

export function summary(r: TreasuryReport): string {
  const last = r.recentActions[0];
  return (
    `Treasury ${r.totalBnb} BNB: ${r.liquidBnb} liquid (reserve target ${r.reserveTargetBnb}), ${r.suppliedBnb} in Venus at ${r.venusApy}. ` +
    `Runway ${r.runwayDays} days at ${r.dailyOutflowBnb} BNB/day of scheduled payouts; ${r.activeHires} active hire(s). ` +
    `Next: ${r.nextDecision.kind} - ${r.nextDecision.reason}.` +
    (last ? ` Last action: ${last.kind} ${last.amountBnb} BNB (${last.reason}) tx ${last.txHash}.` : " No actions yet.")
  );
}
