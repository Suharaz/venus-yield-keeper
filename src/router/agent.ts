import { formatEther, maxUint256, type Address, type Hash } from "viem";
import { clients, type Clients } from "../shared/chain";
import { ADDR, BLOCKS_PER_YEAR, comptrollerAbi, vBnbAbi, vErc20Abi, wbnbAbi, type BaseEnv } from "../shared/config";
import { fmtBps } from "../shared/format";
import { activeHireCount, pushAction, syncHires, type ActionRecord, type HireBook } from "../shared/hires";
import { loadDoc } from "../shared/kv-doc";
import type { AgentReport } from "../shared/worker";
import { planRouter, type Asset, type Candidate, type RouterAction, type RouterParams, type Venue } from "./policy";

export interface RouterEnv extends BaseEnv {
  GAS_RESERVE_WEI: string;
  MAX_SHARE_BPS: string;
  HURDLE_BPS: string;
  ACTIVE_HURDLE_BPS: string;
  CONFIRM_SEC: string;
  MIN_APY_BPS: string;
  BAND_BPS: string;
  MIN_MOVE_WEI: string;
  EXIT_CASH_MULTIPLE: string;
  KEEP_CASH_MULTIPLE: string;
}

interface VenueConfig {
  id: string;
  label: string;
  asset: Asset;
  vToken: Address;
  comptroller: Address;
}

/** BNB supply markets on Venus (BSC testnet). Same asset, so moving between them needs no swap. */
export const VENUES: VenueConfig[] = [
  { id: "core-vbnb", label: "Venus Core vBNB", asset: "BNB", vToken: ADDR.vBNB, comptroller: ADDR.venusComptroller },
  { id: "core-vwbnb", label: "Venus Core vWBNB", asset: "WBNB", vToken: ADDR.vWBNBCore, comptroller: ADDR.venusComptroller },
  { id: "lst-vwbnb", label: "Venus Liquid Staked BNB pool vWBNB", asset: "WBNB", vToken: ADDR.vWBNBLst, comptroller: ADDR.lstComptroller },
];
const VENUE_BY_ID = Object.fromEntries(VENUES.map((v) => [v.id, v]));

const STATE_KEY = "state";
/** A tx unknown to the node after this long, with its nonce unused, is treated as dropped. */
const DROP_AFTER_SEC = 180;
const MAX_RANKING_EVENTS = 20;

type ActionKind = Exclude<RouterAction["kind"], "hold">;

interface PendingTx {
  txHash: Hash;
  nonce: number;
  kind: ActionKind;
  venue: string | null;
  amountWei: string;
  all: boolean;
  vTokenBefore: string;
  sentAt: number;
  record: Omit<ActionRecord, "ok">;
}

interface RouterState extends HireBook {
  /** Per-venue BNB moved in minus moved out (interest excluded). */
  principal: Record<string, string>;
  ranking: string[] | null;
  candidate: Candidate | null;
  rankingEvents: { at: string; ranking: string[]; reason: string }[];
  pending: PendingTx | null;
}

const EMPTY_STATE: RouterState = { principal: {}, ranking: null, candidate: null, rankingEvents: [], lastSubId: 0, hires: {}, actions: [], pending: null };

function params(env: RouterEnv): RouterParams {
  return {
    gasReserveWei: BigInt(env.GAS_RESERVE_WEI),
    maxShareBps: BigInt(env.MAX_SHARE_BPS),
    hurdleBps: BigInt(env.HURDLE_BPS),
    activeHurdleBps: BigInt(env.ACTIVE_HURDLE_BPS),
    confirmSec: Number(env.CONFIRM_SEC),
    minApyBps: BigInt(env.MIN_APY_BPS),
    bandBps: BigInt(env.BAND_BPS),
    minMoveWei: BigInt(env.MIN_MOVE_WEI),
    exitCashMultiple: BigInt(env.EXIT_CASH_MULTIPLE),
    keepCashMultiple: BigInt(env.KEEP_CASH_MULTIPLE),
  };
}

interface Market {
  venues: (Venue & { vTokenBalance: bigint })[];
  liquidBnbWei: bigint;
  wbnbWei: bigint;
}

async function readVenue(c: Clients, cfg: VenueConfig): Promise<Venue & { vTokenBalance: bigint }> {
  const { publicClient, account } = c;
  const v = { address: cfg.vToken, abi: vErc20Abi } as const;
  const comp = { address: cfg.comptroller, abi: comptrollerAbi } as const;
  const [rate, cash, totalSupply, vTokenBalance, exchangeRate, mintPaused, redeemPaused, supplyCap, allowanceWei] = await Promise.all([
    publicClient.readContract({ ...v, functionName: "supplyRatePerBlock" }),
    publicClient.readContract({ ...v, functionName: "getCash" }),
    publicClient.readContract({ ...v, functionName: "totalSupply" }),
    publicClient.readContract({ ...v, functionName: "balanceOf", args: [account.address] }),
    // exchangeRateStored lags until someone touches the market; simulate the accruing call.
    publicClient.simulateContract({ ...v, functionName: "exchangeRateCurrent", account: account.address }).then((r) => r.result),
    publicClient.readContract({ ...comp, functionName: "actionPaused", args: [cfg.vToken, 0] }),
    publicClient.readContract({ ...comp, functionName: "actionPaused", args: [cfg.vToken, 1] }),
    publicClient.readContract({ ...comp, functionName: "supplyCaps", args: [cfg.vToken] }),
    cfg.asset === "WBNB"
      ? publicClient.readContract({ address: ADDR.wbnb, abi: wbnbAbi, functionName: "allowance", args: [account.address, cfg.vToken] })
      : Promise.resolve(0n),
  ]);
  const totalUnderlying = (totalSupply * exchangeRate) / 10n ** 18n;
  return {
    id: cfg.id,
    label: cfg.label,
    asset: cfg.asset,
    // All three markets are block-based; BSC testnet blocks measured at 0.45 s (70,080,000 per year).
    apyBps: (rate * BLOCKS_PER_YEAR * 10_000n) / 10n ** 18n,
    cashWei: cash,
    capHeadroomWei: supplyCap === maxUint256 ? maxUint256 : supplyCap > totalUnderlying ? supplyCap - totalUnderlying : 0n,
    mintPaused,
    redeemPaused,
    positionWei: (vTokenBalance * exchangeRate) / 10n ** 18n,
    vTokenBalance,
    allowanceWei,
  };
}

async function readMarket(c: Clients): Promise<Market> {
  const [venues, liquidBnbWei, wbnbWei] = await Promise.all([
    Promise.all(VENUES.map((cfg) => readVenue(c, cfg))),
    c.publicClient.getBalance({ address: c.account.address }),
    c.publicClient.readContract({ address: ADDR.wbnb, abi: wbnbAbi, functionName: "balanceOf", args: [c.account.address] }),
  ]);
  return { venues, liquidBnbWei, wbnbWei };
}

function plan(env: RouterEnv, state: RouterState, m: Market, nowSec: number, jobHires: number) {
  const activeHires = activeHireCount(state, nowSec) + jobHires;
  return { activeHires, ...planRouter(params(env), { venues: m.venues, liquidBnbWei: m.liquidBnbWei, wbnbWei: m.wbnbWei, activeHires, nowSec, ranking: state.ranking, candidate: state.candidate }) };
}

async function execute(a: Exclude<RouterAction, { kind: "hold" }>, m: Market, c: Clients, nonce: number): Promise<Hash> {
  const { publicClient, walletClient, account } = c;
  const wbnb = { address: ADDR.wbnb, abi: wbnbAbi, account, nonce } as const;
  switch (a.kind) {
    case "wrap": {
      const { request } = await publicClient.simulateContract({ ...wbnb, functionName: "deposit", value: a.amountWei });
      return walletClient.writeContract(request);
    }
    case "unwrap": {
      const { request } = await publicClient.simulateContract({ ...wbnb, functionName: "withdraw", args: [a.amountWei] });
      return walletClient.writeContract(request);
    }
    case "approve": {
      const { request } = await publicClient.simulateContract({ ...wbnb, functionName: "approve", args: [VENUE_BY_ID[a.venue].vToken, maxUint256] });
      return walletClient.writeContract(request);
    }
    case "deposit": {
      const cfg = VENUE_BY_ID[a.venue];
      if (cfg.asset === "BNB") {
        const { request } = await publicClient.simulateContract({ address: cfg.vToken, abi: vBnbAbi, account, nonce, functionName: "mint", value: a.amountWei });
        return walletClient.writeContract(request);
      }
      const { request } = await publicClient.simulateContract({ address: cfg.vToken, abi: vErc20Abi, account, nonce, functionName: "mint", args: [a.amountWei] });
      return walletClient.writeContract(request);
    }
    case "withdraw": {
      const cfg = VENUE_BY_ID[a.venue];
      const vTokenBalance = m.venues.find((v) => v.id === a.venue)!.vTokenBalance;
      if (a.all) {
        const { request } = await publicClient.simulateContract({ address: cfg.vToken, abi: vErc20Abi, account, nonce, functionName: "redeem", args: [vTokenBalance] });
        return walletClient.writeContract(request);
      }
      const { request } = await publicClient.simulateContract({ address: cfg.vToken, abi: vErc20Abi, account, nonce, functionName: "redeemUnderlying", args: [a.amountWei] });
      return walletClient.writeContract(request);
    }
  }
}

/**
 * Resolve the in-flight tx. Returns true while it may still land (caller must not act).
 * Dropped only when the node no longer knows it AND its nonce is still unused.
 */
async function settlePending(state: RouterState, c: Clients, nowSec: number): Promise<boolean> {
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
  if (ok && p.venue && (p.kind === "deposit" || p.kind === "withdraw")) {
    // Core-pool markets can soft-fail (Failure event, no revert): trust the vToken balance.
    const after = await publicClient.readContract({ address: VENUE_BY_ID[p.venue].vToken, abi: vErc20Abi, functionName: "balanceOf", args: [account.address] });
    ok = after !== BigInt(p.vTokenBefore);
  }
  if (ok && p.venue) {
    const principal = BigInt(state.principal[p.venue] ?? "0");
    const amount = BigInt(p.amountWei);
    if (p.kind === "deposit") state.principal[p.venue] = (principal + amount).toString();
    if (p.kind === "withdraw") state.principal[p.venue] = p.all || amount >= principal ? "0" : (principal - amount).toString();
  }
  pushAction(state, { ...p.record, ok });
  state.pending = null;
  return false;
}

/** One scheduled cycle: complete hires, settle the last tx, re-rank with hysteresis, then at most one move. */
export async function runCycle(env: RouterEnv, jobHires: number): Promise<{ decision: { kind: string; reason: string }; txHash: Hash | null }> {
  const doc = await loadDoc(env.STATE, STATE_KEY, EMPTY_STATE);
  const state = doc.value;
  const saveState = doc.save; // writes only when the state changed
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    try {
      await syncHires(env.LISTING_ID, state, c, nowSec);
    } catch (err) {
      console.error("hire sync failed", err);
    }
    if (await settlePending(state, c, nowSec)) {
      return { decision: { kind: "hold", reason: `waiting for tx ${state.pending?.txHash}` }, txHash: null };
    }

    const [m, nonce] = await Promise.all([readMarket(c), c.publicClient.getTransactionCount({ address: c.account.address, blockTag: "pending" })]);
    const pl = plan(env, state, m, nowSec, jobHires);
    state.ranking = pl.ranking;
    state.candidate = pl.candidate;
    if (pl.rankingChange) {
      state.rankingEvents.unshift({ at: new Date(nowSec * 1000).toISOString(), ranking: pl.ranking, reason: pl.rankingChange });
      state.rankingEvents.length = Math.min(state.rankingEvents.length, MAX_RANKING_EVENTS);
    }
    const a = pl.action;
    if (a.kind === "hold") return { decision: a, txHash: null };

    const txHash = await execute(a, m, c, nonce);
    const venue = "venue" in a ? a.venue : null;
    const amountWei = "amountWei" in a ? a.amountWei : 0n;
    const v = venue ? m.venues.find((x) => x.id === venue) : undefined;
    state.pending = {
      txHash,
      nonce,
      kind: a.kind,
      venue,
      amountWei: amountWei.toString(),
      all: a.kind === "withdraw" && a.all,
      vTokenBefore: (v?.vTokenBalance ?? 0n).toString(),
      sentAt: nowSec,
      record: {
        at: new Date().toISOString(),
        kind: a.kind,
        amountBnb: formatEther(amountWei),
        reason: a.reason,
        txHash,
        ...(v ? { apyBps: v.apyBps.toString(), suppliedBeforeBnb: formatEther(v.positionWei), targetBnb: formatEther(pl.targets[v.id]) } : {}),
        liquidBeforeBnb: formatEther(m.liquidBnbWei),
      },
    };
    await saveState(); // the tx is out: record it before anything else can throw
    try {
      await c.publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1_000 });
    } catch (err) {
      console.error("receipt wait failed; will settle next cycle", err);
    }
    await settlePending(state, c, Math.floor(Date.now() / 1000));
    return { decision: a, txHash };
  } finally {
    await saveState();
  }
}

export interface RouterVenueReport {
  id: string;
  label: string;
  asset: Asset;
  apy: string;
  positionBnb: string;
  targetBnb: string;
  accruedBnb: string;
  cashBnb: string;
  mintPaused: boolean;
  redeemPaused: boolean;
  eligible: boolean;
}

export interface RouterReport extends AgentReport {
  capitalBnb: string;
  liquidBnb: string;
  wbnbBnb: string;
  /** Position-weighted APY of what is deployed. */
  blendedApy: string;
  /** Blended APY minus Venus Core vBNB (the single-market baseline). */
  edgeVsCore: string;
  accruedInterestBnb: string;
  venues: RouterVenueReport[];
  ranking: string[];
  candidate: { leader: string; since: string } | null;
  rankingEvents: RouterState["rankingEvents"];
}

export async function report(env: RouterEnv, jobHires: number): Promise<RouterReport> {
  const doc = await loadDoc(env.STATE, STATE_KEY, EMPTY_STATE);
  const state = doc.value;
  const c = clients(env);
  const nowSec = Math.floor(Date.now() / 1000);
  const m = await readMarket(c);
  const pl = plan(env, state, m, nowSec, jobHires);
  const deployed = m.venues.reduce((s, v) => s + v.positionWei, 0n);
  const blendedBps = deployed === 0n ? 0n : m.venues.reduce((s, v) => s + v.positionWei * v.apyBps, 0n) / deployed;
  const coreBps = m.venues.find((v) => v.id === "core-vbnb")!.apyBps;
  let accrued = 0n;
  const venues = m.venues.map((v) => {
    const principal = BigInt(state.principal[v.id] ?? "0");
    const acc = v.positionWei > principal ? v.positionWei - principal : 0n;
    accrued += acc;
    return {
      id: v.id,
      label: v.label,
      asset: v.asset,
      apy: fmtBps(v.apyBps),
      positionBnb: formatEther(v.positionWei),
      targetBnb: formatEther(pl.targets[v.id]),
      accruedBnb: formatEther(acc),
      cashBnb: formatEther(v.cashWei),
      mintPaused: v.mintPaused,
      redeemPaused: v.redeemPaused,
      eligible: pl.ranking.includes(v.id) && pl.targets[v.id] > 0n,
    };
  });
  return {
    agentWallet: c.account.address,
    capitalBnb: formatEther(pl.capitalWei),
    liquidBnb: formatEther(m.liquidBnbWei),
    wbnbBnb: formatEther(m.wbnbWei),
    blendedApy: fmtBps(blendedBps),
    edgeVsCore: deployed === 0n ? "n/a" : `${blendedBps >= coreBps ? "+" : "-"}${fmtBps(blendedBps >= coreBps ? blendedBps - coreBps : coreBps - blendedBps)}`,
    accruedInterestBnb: formatEther(accrued),
    venues,
    ranking: pl.ranking,
    candidate: pl.candidate ? { leader: pl.candidate.leader, since: new Date(pl.candidate.sinceSec * 1000).toISOString() } : null,
    rankingEvents: state.rankingEvents,
    activeHires: pl.activeHires,
    hiresTracked: Object.keys(state.hires).length,
    nextDecision: { kind: pl.action.kind, reason: pl.action.reason },
    pendingTx: state.pending?.txHash ?? null,
    recentActions: state.actions.slice(0, 20),
  };
}

export function summary(r: RouterReport): string {
  const last = r.recentActions[0];
  const placed = r.venues.filter((v) => Number(v.positionBnb) > 0).map((v) => `${v.label} ${Number(v.positionBnb).toFixed(5)} BNB at ${v.apy}`);
  return (
    `Routing ${r.capitalBnb} BNB across Venus BNB markets: ${placed.length ? placed.join("; ") : "nothing deployed yet"}. ` +
    `Blended APY ${r.blendedApy} (${r.edgeVsCore} vs Venus Core vBNB). ${r.activeHires} active hire(s). ` +
    `Next: ${r.nextDecision.kind} - ${r.nextDecision.reason}` +
    (last ? ` Last action: ${last.kind} ${last.amountBnb} BNB (${last.reason}) tx ${last.txHash}.` : " No actions yet.")
  );
}
