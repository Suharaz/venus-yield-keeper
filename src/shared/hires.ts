import { formatEther, type Address, type Hash } from "viem";
import type { Clients } from "./chain";
import { ADDR, fuguSubscriptionAbi } from "./config";

const MAX_SUBS_PER_CYCLE = 25;
const MAX_ACTIONS_KEPT = 100;

/** One onchain action with the reason it was taken; the agent's public ledger. */
export interface ActionRecord {
  at: string;
  kind: string;
  amountBnb: string;
  reason: string;
  txHash: Hash;
  ok: boolean;
  /** Inputs the decision was made from (present where relevant). */
  apyBps?: string;
  suppliedBeforeBnb?: string;
  liquidBeforeBnb?: string;
  targetBnb?: string;
  reserveTargetBnb?: string;
  to?: string;
  payoutKey?: string;
  subId?: string;
}

export interface HireRecord {
  subscriber: Address;
  endsAt: number;
  depositedWei: string;
  done: boolean;
}

/** State shared by every agent: HelloFugu hires seen so far and the action ledger. */
export interface HireBook {
  /** Highest FuguSubscription subId already scanned. */
  lastSubId: number;
  hires: Record<string, HireRecord>;
  actions: ActionRecord[];
}

export function pushAction(book: Pick<HireBook, "actions">, a: ActionRecord) {
  book.actions.unshift(a);
  book.actions.length = Math.min(book.actions.length, MAX_ACTIONS_KEPT);
}

export function activeHireCount(book: HireBook, nowSec: number): number {
  return Object.values(book.hires).filter((h) => !h.done && h.endsAt > nowSec).length;
}

/**
 * Track hires of our HelloFugu listing and complete finished ones with claim(subId)
 * (permissionless; pays the listing owner). A sub is complete once endsAt has passed
 * and claimed == deposited.
 */
export async function syncHires(listingIdVar: string, book: HireBook, c: Clients, nowSec: number) {
  if (!listingIdVar) return;
  const listingId = BigInt(listingIdVar);
  const { publicClient, walletClient, account } = c;
  const sub = { address: ADDR.fuguSubscription, abi: fuguSubscriptionAbi } as const;

  const count = Number(await publicClient.readContract({ ...sub, functionName: "subCount" }));
  const ids = Array.from({ length: Math.min(count - book.lastSubId, MAX_SUBS_PER_CYCLE) }, (_, i) => book.lastSubId + 1 + i);
  const subs = await Promise.all(ids.map((id) => publicClient.readContract({ ...sub, functionName: "getSub", args: [BigInt(id)] })));
  subs.forEach((s, i) => {
    if (s.listingId === listingId) {
      book.hires[ids[i]] = { subscriber: s.subscriber, endsAt: Number(s.endsAt), depositedWei: s.deposited.toString(), done: false };
    }
  });
  if (ids.length) book.lastSubId = ids[ids.length - 1];

  for (const [subId, hire] of Object.entries(book.hires)) {
    if (hire.done || hire.endsAt > nowSec) continue;
    const [current, claimable] = await Promise.all([
      publicClient.readContract({ ...sub, functionName: "getSub", args: [BigInt(subId)] }),
      publicClient.readContract({ ...sub, functionName: "claimable", args: [BigInt(subId)] }),
    ]);
    if (claimable > 0n) {
      const { request } = await publicClient.simulateContract({ ...sub, functionName: "claim", args: [BigInt(subId)], account });
      const txHash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 1_000 });
      pushAction(book, {
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
