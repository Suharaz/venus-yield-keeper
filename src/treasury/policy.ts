/**
 * Treasury policy for an agent-fleet BNB treasury. Pure: no I/O, so every decision is
 * reproducible from the inputs recorded next to its transaction.
 *
 * Liquid reserve target = floor + daily scheduled outflow * runway days + per-hire reserve * active hires.
 * Order of rules (first match wins, one action per cycle):
 *   1. Venus APY below floor and something supplied  -> exitVenus (bring the whole treasury liquid)
 *   2. A scheduled payout is due today                -> payout it, or topUp from Venus first if liquid is short
 *   3. Liquid below target by more than the band      -> topUp (redeem the deficit from Venus)
 *   4. Liquid above target by more than the band      -> sweep (supply the surplus to Venus)
 *   5. otherwise                                      -> hold
 * A payout is keyed by UTC day + payee index and is paid at most once per key.
 */
import { fmtBps } from "../shared/format";

export interface Payee {
  label: string;
  to: `0x${string}`;
  /** Paid once per UTC day. */
  amountWei: bigint;
}

export interface TreasuryParams {
  floorWei: bigint;
  runwayDays: bigint;
  perHireReserveWei: bigint;
  /** Hysteresis around the reserve target, in bps of the target. */
  bandBps: bigint;
  minApyBps: bigint;
  payees: Payee[];
}

export interface TreasurySnapshot {
  apyBps: bigint;
  liquidWei: bigint;
  suppliedWei: bigint;
  activeHires: number;
  today: string;
  /** Payout keys already paid ("YYYY-MM-DD:index"). */
  paid: Readonly<Record<string, string>>;
  mintPaused: boolean;
  redeemPaused: boolean;
}

export type TreasuryDecision =
  | { kind: "payout"; amountWei: bigint; to: `0x${string}`; payoutKey: string; reason: string; reserveTargetWei: bigint }
  | { kind: "topUp"; amountWei: bigint; reason: string; reserveTargetWei: bigint }
  | { kind: "sweep"; amountWei: bigint; reason: string; reserveTargetWei: bigint }
  | { kind: "exitVenus"; reason: string; reserveTargetWei: bigint }
  | { kind: "hold"; reason: string; reserveTargetWei: bigint };

const BPS = 10_000n;
const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(5)} BNB`;

export function dailyOutflowWei(p: TreasuryParams): bigint {
  return p.payees.reduce((sum, x) => sum + x.amountWei, 0n);
}

export function reserveTargetWei(p: TreasuryParams, activeHires: number): bigint {
  return p.floorWei + dailyOutflowWei(p) * p.runwayDays + p.perHireReserveWei * BigInt(activeHires);
}

export function decideTreasury(p: TreasuryParams, s: TreasurySnapshot): TreasuryDecision {
  const target = reserveTargetWei(p, s.activeHires);
  const band = (target * p.bandBps) / BPS;
  const hold = (reason: string): TreasuryDecision => ({ kind: "hold", reason, reserveTargetWei: target });
  const topUp = (amountWei: bigint, reason: string): TreasuryDecision => {
    if (s.redeemPaused) return hold(`top-up needed (${reason}) but Venus redeem is paused`);
    return { kind: "topUp", amountWei: amountWei > s.suppliedWei ? s.suppliedWei : amountWei, reason, reserveTargetWei: target };
  };

  if (s.apyBps < p.minApyBps && s.suppliedWei > 0n) {
    if (s.redeemPaused) return hold("APY below floor but Venus redeem is paused");
    return { kind: "exitVenus", reason: `Venus APY ${fmtBps(s.apyBps)} below floor ${fmtBps(p.minApyBps)}: hold the treasury liquid`, reserveTargetWei: target };
  }

  for (const [i, payee] of p.payees.entries()) {
    const payoutKey = `${s.today}:${i}`;
    if (payoutKey in s.paid) continue;
    if (s.liquidWei >= p.floorWei + payee.amountWei) {
      return {
        kind: "payout",
        amountWei: payee.amountWei,
        to: payee.to,
        payoutKey,
        reason: `scheduled daily payout ${s.today} to ${payee.label}`,
        reserveTargetWei: target,
      };
    }
    if (s.suppliedWei > 0n) return topUp(target + payee.amountWei - s.liquidWei, `fund today's payout to ${payee.label}`);
    return hold(`payout to ${payee.label} due but treasury holds only ${fmt(s.liquidWei)}`);
  }

  if (s.liquidWei + band < target && s.suppliedWei > 0n) {
    return topUp(target - s.liquidWei, `liquid ${fmt(s.liquidWei)} below reserve target ${fmt(target)} (${s.activeHires} active hire(s))`);
  }
  if (s.liquidWei > target + band && s.apyBps >= p.minApyBps) {
    if (s.mintPaused) return hold("surplus to sweep but Venus mint is paused");
    return {
      kind: "sweep",
      amountWei: s.liquidWei - target,
      reason: `liquid ${fmt(s.liquidWei)} above reserve target ${fmt(target)}: put the surplus to work at ${fmtBps(s.apyBps)}`,
      reserveTargetWei: target,
    };
  }
  return hold(`reserve within ${fmtBps(p.bandBps)} of target ${fmt(target)}; today's payouts done`);
}
