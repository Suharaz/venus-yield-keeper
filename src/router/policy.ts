/**
 * Rate router for BNB across Venus markets. Pure: no I/O, so every decision is reproducible
 * from the inputs recorded next to its transaction.
 *
 * Capacity of a venue = 0 if mint is paused or APY < floor, else
 *   min(concentration cap, exit-liquidity limit, supply-cap headroom + our position).
 * Exit-liquidity limit has its own hysteresis band, so one borrower moving the market's cash
 * does not churn funds: new money only up to cash / exitCashMultiple (3), but a position already
 * placed is kept while it stays within cash / keepCashMultiple (2), and only the part above that is cut.
 * It limits how much can be stuck, not whether: a borrower who drains cash to ~0 blocks every
 * withdrawal until repayment (withdrawals are capped by cash).
 * Allocation: walk the committed ranking (best APY first) and fill each venue up to its capacity;
 * what is left stays liquid.
 * Ranking commits (hysteresis, so noise never moves funds):
 *   - first run, or the committed leader lost its capacity      -> commit the live ranking now
 *   - a new leader beats the committed one by >= hurdle          -> commit after it held for confirmSec
 *     (the hurdle is lower while hires are active: paid = more responsive)
 * Action order (one per cycle): withdraw excess -> unwrap/wrap -> approve -> deposit -> hold.
 */
import { fmtBps } from "../shared/format";

export type Asset = "BNB" | "WBNB";

export interface Venue {
  id: string;
  label: string;
  asset: Asset;
  apyBps: bigint;
  cashWei: bigint;
  /** Supply-cap room left in the market (max uint = no cap). */
  capHeadroomWei: bigint;
  mintPaused: boolean;
  redeemPaused: boolean;
  /** Our supplied balance in underlying terms. */
  positionWei: bigint;
  /** WBNB allowance from the agent wallet to this market (BNB markets: unused). */
  allowanceWei: bigint;
}

export interface RouterParams {
  gasReserveWei: bigint;
  maxShareBps: bigint;
  hurdleBps: bigint;
  activeHurdleBps: bigint;
  confirmSec: number;
  minApyBps: bigint;
  bandBps: bigint;
  minMoveWei: bigint;
  exitCashMultiple: bigint;
  keepCashMultiple: bigint;
}

export interface Candidate {
  leader: string;
  sinceSec: number;
}

export interface RouterSnapshot {
  venues: Venue[];
  liquidBnbWei: bigint;
  wbnbWei: bigint;
  activeHires: number;
  nowSec: number;
  /** Committed venue order, best first; null before the first commit. */
  ranking: string[] | null;
  candidate: Candidate | null;
}

export type RouterAction =
  | { kind: "withdraw"; venue: string; amountWei: bigint; all: boolean; reason: string }
  | { kind: "wrap" | "unwrap"; amountWei: bigint; reason: string }
  | { kind: "approve"; venue: string; reason: string }
  | { kind: "deposit"; venue: string; amountWei: bigint; reason: string }
  | { kind: "hold"; reason: string };

export interface RouterPlan {
  action: RouterAction;
  ranking: string[];
  candidate: Candidate | null;
  /** Set when this cycle committed a new ranking. */
  rankingChange: string | null;
  capitalWei: bigint;
  targets: Record<string, bigint>;
}

const BPS = 10_000n;
const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(5)} BNB`;
const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

export function capacityWei(p: RouterParams, v: Venue, capitalWei: bigint): bigint {
  if (v.mintPaused || v.apyBps < p.minApyBps) return 0n;
  const fill = v.cashWei / p.exitCashMultiple;
  const keep = min(v.positionWei, v.cashWei / p.keepCashMultiple);
  return min((capitalWei * p.maxShareBps) / BPS, fill > keep ? fill : keep, v.capHeadroomWei + v.positionWei);
}

export function planRouter(p: RouterParams, s: RouterSnapshot): RouterPlan {
  const byId = Object.fromEntries(s.venues.map((v) => [v.id, v]));
  const freeBnb = s.liquidBnbWei > p.gasReserveWei ? s.liquidBnbWei - p.gasReserveWei : 0n;
  const capitalWei = freeBnb + s.wbnbWei + s.venues.reduce((sum, v) => sum + v.positionWei, 0n);
  const cap = (v: Venue) => capacityWei(p, v, capitalWei);
  // Eligibility ignores our own size, so the ranking exists before the first deposit.
  const eligible = (v: Venue) => capacityWei(p, v, 1n << 128n) > 0n;

  // Ranking with hysteresis.
  const live = s.venues.filter(eligible).sort((a, b) => Number(b.apyBps - a.apyBps)).map((v) => v.id);
  let ranking = s.ranking?.filter((id) => byId[id]) ?? [];
  let candidate = s.candidate;
  let rankingChange: string | null = null;
  const committedLeader = ranking.find((id) => eligible(byId[id]));
  const liveLeader = live[0];
  if (liveLeader && (!s.ranking || !committedLeader)) {
    ranking = live;
    candidate = null;
    rankingChange = s.ranking ? `committed leader lost capacity: route to ${byId[liveLeader].label}` : `initial ranking: ${byId[liveLeader].label} first`;
  } else if (liveLeader && committedLeader && liveLeader !== committedLeader) {
    const edge = byId[liveLeader].apyBps - byId[committedLeader].apyBps;
    const hurdle = s.activeHires > 0 ? p.activeHurdleBps : p.hurdleBps;
    if (edge < hurdle) {
      candidate = null;
    } else if (candidate?.leader === liveLeader && s.nowSec - candidate.sinceSec >= p.confirmSec) {
      ranking = live;
      candidate = null;
      rankingChange = `${byId[liveLeader].label} beat ${byId[committedLeader].label} by ${fmtBps(edge)} for ${p.confirmSec / 60} min: re-rank`;
    } else if (candidate?.leader !== liveLeader) {
      candidate = { leader: liveLeader, sinceSec: s.nowSec };
    }
  } else {
    candidate = null;
  }
  // Venues the committed ranking does not know yet go last, in live order.
  ranking = [...ranking, ...live.filter((id) => !ranking.includes(id))];

  // Targets: fill the committed order up to each venue's capacity.
  const targets: Record<string, bigint> = {};
  let left = capitalWei;
  for (const v of s.venues) targets[v.id] = 0n;
  for (const id of ranking) {
    const t = min(cap(byId[id]), left);
    targets[id] = t;
    left -= t;
  }

  const bandRaw = (capitalWei * p.bandBps) / BPS;
  const band = bandRaw > p.minMoveWei ? bandRaw : p.minMoveWei;
  const plan = (action: RouterAction): RouterPlan => ({ action, ranking, candidate, rankingChange, capitalWei, targets });

  // 1. Withdraw the largest excess (or everything from a venue with no target).
  const excess = s.venues
    .filter((v) => !v.redeemPaused && v.positionWei > targets[v.id] + band)
    .map((v) => ({ v, amount: min(v.positionWei - targets[v.id], v.cashWei) }))
    .sort((a, b) => Number(b.amount - a.amount))[0];
  if (excess && excess.amount >= p.minMoveWei) {
    const all = targets[excess.v.id] === 0n && excess.amount === excess.v.positionWei;
    return plan({
      kind: "withdraw",
      venue: excess.v.id,
      amountWei: excess.amount,
      all,
      reason: `${excess.v.label} holds ${fmt(excess.v.positionWei)}, target ${fmt(targets[excess.v.id])} (APY ${fmtBps(excess.v.apyBps)}): rebalance out`,
    });
  }

  // 2. Fill deficits in ranking order, converting BNB <-> WBNB and approving as needed.
  for (const id of ranking) {
    const v = byId[id];
    const need = targets[id] - v.positionWei;
    if (need <= band) continue;
    const have = v.asset === "BNB" ? freeBnb : s.wbnbWei;
    const other = v.asset === "BNB" ? s.wbnbWei : freeBnb;
    const why = `${v.label} at ${fmtBps(v.apyBps)} is below target ${fmt(targets[id])} by ${fmt(need)}`;
    if (have < need && other >= p.minMoveWei) {
      return plan({ kind: v.asset === "BNB" ? "unwrap" : "wrap", amountWei: min(other, need - have), reason: `${why}: convert ${v.asset === "BNB" ? "WBNB to BNB" : "BNB to WBNB"}` });
    }
    const amount = min(need, have);
    if (amount < p.minMoveWei) continue;
    if (v.asset === "WBNB" && v.allowanceWei < amount) {
      return plan({ kind: "approve", venue: id, reason: `${why}: allow ${v.label} to pull WBNB` });
    }
    return plan({ kind: "deposit", venue: id, amountWei: amount, reason: `${why}: rebalance in` });
  }

  const leaderId = ranking.find((id) => eligible(byId[id]));
  const leader = leaderId ? byId[leaderId] : null;
  const waiting = candidate ? ` ${byId[candidate.leader].label} leads live; confirming since ${new Date(candidate.sinceSec * 1000).toISOString().slice(11, 16)} UTC.` : "";
  const reason = !leader
    ? "no eligible Venus market: stay liquid"
    : capitalWei < p.minMoveWei
      ? `capital ${fmt(capitalWei)} above the ${fmt(p.gasReserveWei)} gas reserve is below the ${fmt(p.minMoveWei)} minimum move; ${leader.label} leads at ${fmtBps(leader.apyBps)}`
      : `allocation within ${fmt(band)} of target; ${leader.label} leads at ${fmtBps(leader.apyBps)}.${waiting}`;
  return plan({ kind: "hold", reason });
}
