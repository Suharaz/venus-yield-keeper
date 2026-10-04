export function fmtBps(bps: bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

/** Share of a total in basis points; 0 when the total is 0. */
export function shareBps(part: bigint, total: bigint): number {
  return total === 0n ? 0 : Number((part * 10_000n) / total);
}
