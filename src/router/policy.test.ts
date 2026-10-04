import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEther, maxUint256 } from "viem";
import { planRouter, type RouterParams, type RouterSnapshot, type Venue } from "./policy";

const P: RouterParams = {
  gasReserveWei: parseEther("0.01"),
  maxShareBps: 6000n,
  hurdleBps: 300n,
  activeHurdleBps: 100n,
  confirmSec: 900,
  minApyBps: 100n,
  bandBps: 500n,
  minMoveWei: parseEther("0.002"),
  exitCashMultiple: 3n,
  keepCashMultiple: 2n,
};

function venue(id: string, asset: Venue["asset"], apyBps: bigint, cash: string, extra: Partial<Venue> = {}): Venue {
  return { id, label: id, asset, apyBps, cashWei: parseEther(cash), capHeadroomWei: maxUint256, mintPaused: false, redeemPaused: false, positionWei: 0n, allowanceWei: maxUint256, ...extra };
}

/** Steady state seen live on 2026-10-04: 0.024 in the LST pool, 0.016 in Core vBNB, gas reserve liquid. */
function placed(lstCash: string, lstApy = 6222n, coreApy = 3521n): RouterSnapshot {
  return {
    venues: [
      venue("core-vbnb", "BNB", coreApy, "25", { positionWei: parseEther("0.016") }),
      venue("lst-vwbnb", "WBNB", lstApy, lstCash, { positionWei: parseEther("0.024") }),
    ],
    liquidBnbWei: parseEther("0.01"),
    wbnbWei: 0n,
    activeHires: 0,
    nowSec: 1_000,
    ranking: ["lst-vwbnb", "core-vbnb"],
    candidate: null,
  };
}

test("a borrow that leaves the position within cash / 2 moves nothing", () => {
  // 0.110 cash after a ~0.55 WBNB borrow: cash / 3 = 0.0367 >= 0.024 anyway; 0.05 cash: cash / 3 = 0.0167 < 0.024 <= cash / 2.
  for (const cash of ["0.657", "0.110", "0.05"]) {
    assert.equal(planRouter(P, placed(cash)).action.kind, "hold", `cash ${cash}`);
  }
});

test("a borrow that pushes the position above cash / 2 cuts only the part above cash / 2", () => {
  const plan = planRouter(P, placed("0.03"));
  assert.equal(plan.action.kind, "withdraw");
  assert.equal(plan.action.kind === "withdraw" && plan.action.venue, "lst-vwbnb");
  assert.equal(plan.action.kind === "withdraw" && plan.action.amountWei, parseEther("0.009"));
});

test("withdrawals never exceed the market's cash (drained market: nothing to withdraw)", () => {
  const paused = placed("0.001");
  paused.venues[1].mintPaused = true;
  const plan = planRouter(P, paused);
  assert.notEqual(plan.action.kind === "withdraw" && plan.action.venue, "lst-vwbnb");
  const partial = placed("0.02");
  partial.venues[1].mintPaused = true;
  const p2 = planRouter(P, partial);
  assert.equal(p2.action.kind === "withdraw" && p2.action.amountWei, parseEther("0.02"));
});

test("after a cut, money returns only once cash / 3 has room again", () => {
  const cut = placed("0.03");
  cut.venues[1].positionWei = parseEther("0.015");
  cut.venues[0].positionWei = parseEther("0.025");
  // Repay to 0.05: cash / 3 = 0.0167, within the 0.002 minimum move of 0.015 -> hold.
  assert.equal(planRouter(P, { ...cut, venues: [cut.venues[0], { ...cut.venues[1], cashWei: parseEther("0.05") }] }).action.kind, "hold");
  // Repay to 0.657: cash / 3 has room -> the LST pool is refilled (out of Core first).
  const refill = planRouter(P, { ...cut, venues: [cut.venues[0], { ...cut.venues[1], cashWei: parseEther("0.657") }] });
  assert.equal(refill.action.kind, "withdraw");
  assert.equal(refill.action.kind === "withdraw" && refill.action.venue, "core-vbnb");
});

test("a rate edge below the hurdle never re-ranks; above it, only after confirmSec", () => {
  const small = planRouter(P, placed("0.657", 6222n, 6400n));
  assert.equal(small.action.kind, "hold");
  assert.equal(small.candidate, null);

  const big = placed("0.657", 6222n, 7000n);
  const first = planRouter(P, big);
  assert.equal(first.action.kind, "hold");
  assert.equal(first.candidate?.leader, "core-vbnb");
  const early = planRouter(P, { ...big, nowSec: 1_000 + 899, candidate: first.candidate });
  assert.equal(early.action.kind, "hold");
  const late = planRouter(P, { ...big, nowSec: 1_000 + 900, candidate: first.candidate });
  assert.deepEqual(late.ranking.slice(0, 1), ["core-vbnb"]);
  assert.match(late.rankingChange ?? "", /re-rank/);
});

test("an active hire lowers the hurdle to activeHurdleBps", () => {
  const s = { ...placed("0.657", 6222n, 6400n), activeHires: 1 };
  assert.equal(planRouter(P, s).candidate?.leader, "core-vbnb");
});

test("the gas reserve is never deployed", () => {
  const plan = planRouter(P, { ...placed("0.657"), venues: placed("0.657").venues.map((v) => ({ ...v, positionWei: 0n })), liquidBnbWei: parseEther("0.011") });
  assert.equal(plan.action.kind, "hold");
  assert.equal(plan.capitalWei, parseEther("0.001"));
});
