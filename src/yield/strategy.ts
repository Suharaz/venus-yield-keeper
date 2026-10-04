/**
 * Yield rule for BNB supplied to Venus (vBNB). Pure: no I/O, so every decision is
 * reproducible from the inputs logged next to its transaction.
 *
 * Capital = free wallet BNB above the gas reserve + BNB already supplied.
 * Target share supplied:
 *   - 0                                   when APY < minApy (do not lend at a bad rate)
 *   - base + perHire * activeHires, capped otherwise (each paying hire raises the target)
 * Order of rules:
 *   1. APY below floor and something supplied   -> withdraw everything
 *   2. supplied differs from target by > band   -> supply / withdraw the difference
 *   3. new UTC day and accrued interest >= min  -> harvest the accrued interest
 *   4. otherwise                                -> hold
 */

import { fmtBps } from "../shared/format";

export interface StrategyParams {
  minApyBps: bigint;
  baseTargetBps: bigint;
  perHireBps: bigint;
  maxTargetBps: bigint;
  bandBps: bigint;
  gasReserveWei: bigint;
  harvestMinWei: bigint;
}

export interface Snapshot {
  apyBps: bigint;
  walletWei: bigint;
  suppliedWei: bigint;
  /** Net BNB we put in (supplies minus non-harvest withdrawals). */
  principalWei: bigint;
  activeHires: number;
  today: string;
  lastHarvestDay: string | null;
}

export type Decision =
  | { kind: "supply"; amountWei: bigint; reason: string; targetWei: bigint }
  | { kind: "withdraw"; amountWei: bigint; reason: string; targetWei: bigint }
  | { kind: "withdrawAll"; reason: string; targetWei: bigint }
  | { kind: "harvest"; amountWei: bigint; reason: string; targetWei: bigint }
  | { kind: "hold"; reason: string; targetWei: bigint };

const BPS = 10_000n;

export function targetBps(p: StrategyParams, s: Pick<Snapshot, "apyBps" | "activeHires">): bigint {
  if (s.apyBps < p.minApyBps) return 0n;
  const t = p.baseTargetBps + p.perHireBps * BigInt(s.activeHires);
  return t > p.maxTargetBps ? p.maxTargetBps : t;
}

export function decide(p: StrategyParams, s: Snapshot): Decision {
  const free = s.walletWei > p.gasReserveWei ? s.walletWei - p.gasReserveWei : 0n;
  const capital = free + s.suppliedWei;
  const tBps = targetBps(p, s);
  const targetWei = (capital * tBps) / BPS;
  const apy = fmtBps(s.apyBps);
  const sharePart = `-> target ${fmtBps(tBps)} of capital; supplied is ${fmtBps(capital === 0n ? 0n : (s.suppliedWei * BPS) / capital)}`;

  if (tBps === 0n && s.suppliedWei > 0n) {
    return { kind: "withdrawAll", targetWei, reason: `APY ${apy} below floor ${fmtBps(p.minApyBps)}: exit Venus` };
  }

  const band = (capital * p.bandBps) / BPS;
  const diff = targetWei - s.suppliedWei;
  if (diff > band) {
    const amountWei = diff > free ? free : diff;
    if (amountWei > 0n) {
      return {
        kind: "supply",
        amountWei,
        targetWei,
        reason: `APY ${apy}, ${s.activeHires} active hire(s) ${sharePart}`,
      };
    }
  }
  if (-diff > band) {
    return {
      kind: "withdraw",
      amountWei: -diff,
      targetWei,
      reason: `${s.activeHires} active hire(s) ${sharePart}`,
    };
  }

  const accrued = s.suppliedWei > s.principalWei ? s.suppliedWei - s.principalWei : 0n;
  if (s.lastHarvestDay !== s.today && accrued >= p.harvestMinWei) {
    return { kind: "harvest", amountWei: accrued, targetWei, reason: `daily harvest of interest accrued at APY ${apy}` };
  }

  return { kind: "hold", targetWei, reason: `within ${fmtBps(p.bandBps)} band of target ${fmtBps(tBps)}; nothing to harvest yet` };
}
