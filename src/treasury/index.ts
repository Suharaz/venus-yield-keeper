import { parseEther } from "viem";
import type { AgentProfile } from "../shared/cards";
import { shareBps } from "../shared/format";
import { createWorker } from "../shared/worker";
import { report, runCycle, summary, type TreasuryEnv, type TreasuryReport } from "./agent";

const profile: AgentProfile = {
  name: "Runway Treasurer",
  tagline: "Treasury for an agent fleet: payouts paid exactly once, a sized liquid reserve, idle BNB earning in Venus.",
  category: "treasury",
  description:
    "Treasury agent (category: treasury) on BNB Smart Chain testnet. Runs scheduled BNB payouts to the operating wallets of an agent fleet " +
    "exactly once per UTC day (keyed and nonce-guarded, so a restart never pays twice), keeps a liquid reserve sized from those obligations " +
    "plus every active hire, and sweeps idle surplus into the Venus vBNB vault to earn yield (live APY) while it waits, redeeming it back when the reserve runs low. " +
    "Every move is an onchain transaction with its reason recorded. Hire it on HelloFugu or Pokter; ask it (A2A message/send) for runway, reserve and ledger.",
  version: "0.1.0",
  skills: [
    {
      id: "scheduled-payouts",
      name: "Scheduled payouts",
      description: "Pays each configured payee its daily BNB amount exactly once per UTC day, with a public ledger of every payment.",
      tags: ["treasury", "payments", "payroll", "bnb", "bsc-testnet"],
      examples: ["Which payouts went out today?", "How many days of runway are left?"],
    },
    {
      id: "reserve-management",
      name: "Liquid reserve and idle cash",
      description:
        "Holds a liquid reserve = floor + 7 days of payouts + a per-hire reserve; sweeps surplus to Venus vBNB and redeems it when the reserve is short.",
      tags: ["treasury", "cash-management", "venus", "reserve"],
      examples: ["What is the reserve target?", "Show the last treasury actions"],
    },
  ],
  policy: {
    title: "Treasury policy (src/treasury/policy.ts)",
    rules: [
      "Reserve target = 0.01 BNB floor + 7 days of scheduled payouts + 0.01 BNB per active hire.",
      "Each payee is paid once per UTC day; the payout key is stored onchain-confirmed, never twice.",
      "Payout due but liquid short: redeem from Venus first, then pay.",
      "Liquid below target by more than 20%: redeem the deficit from Venus.",
      "Liquid above target by more than 20%: sweep the surplus into Venus vBNB.",
      "Venus APY below 1%: bring the whole treasury back to liquid.",
    ],
  },
  iconSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#1E2230"/><stop offset="1" stop-color="#0E1016"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="14" fill="url(#g)"/>' +
    '<rect x="13" y="17" width="38" height="32" rx="6" fill="none" stroke="#F0B90B" stroke-width="4"/>' +
    '<circle cx="32" cy="33" r="7" fill="none" stroke="#F0B90B" stroke-width="4"/>' +
    '<path d="M32 26v-3M32 43v-3M25 33h-3M42 33h-3" stroke="#F0B90B" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M19 49v4M45 49v4" stroke="#F0B90B" stroke-width="4" stroke-linecap="round"/></svg>',
};

export default createWorker<TreasuryEnv, TreasuryReport>({
  profile,
  runCycle,
  report,
  summary,
  sections(r) {
    const liquid = parseEther(r.liquidBnb);
    const supplied = parseEther(r.suppliedBnb);
    const total = liquid + supplied;
    const reserveOk = liquid >= parseEther(r.reserveTargetBnb) * 8n / 10n;
    return {
      metrics: [
        { label: "Treasury total", value: `${Number(r.totalBnb).toFixed(5)} BNB` },
        { label: "Runway", value: r.runwayDays === "unlimited" ? "unlimited" : `${r.runwayDays} days`, hint: `${r.dailyOutflowBnb} BNB/day scheduled` },
        { label: "Liquid reserve", value: `${Number(r.liquidBnb).toFixed(5)} BNB`, hint: `target ${Number(r.reserveTargetBnb).toFixed(5)} BNB` },
        { label: "Earning in Venus", value: `${Number(r.suppliedBnb).toFixed(5)} BNB`, hint: `APY ${r.venusApy}` },
        { label: "Interest accrued", value: `${Number(r.accruedInterestBnb).toFixed(8)} BNB` },
        { label: "Active hires", value: String(r.activeHires), hint: `${r.hiresTracked} tracked` },
      ],
      allocation: [
        { label: "Earning in Venus vBNB", bnb: r.suppliedBnb, shareBps: shareBps(supplied, total) },
        { label: "Liquid reserve", bnb: r.liquidBnb, shareBps: shareBps(liquid, total) },
      ],
      gates: [
        ...r.payees.map((x) => ({
          label: `Payout: ${x.label}`,
          ok: x.paidToday !== null,
          detail: x.paidToday ? `${x.amountBnb} BNB paid today, tx ${x.paidToday}` : `${x.amountBnb} BNB due today`,
        })),
        { label: "Reserve coverage", ok: reserveOk, detail: reserveOk ? "liquid covers the reserve target" : "below target: top-up next cycle" },
        { label: "Venus redeem", ok: !r.redeemPaused, detail: r.redeemPaused ? "paused: cannot top up from Venus" : "open" },
        { label: "Pending transaction", ok: r.pendingTx === null, detail: r.pendingTx ? `waiting for ${r.pendingTx}` : "none" },
      ],
    };
  },
});
