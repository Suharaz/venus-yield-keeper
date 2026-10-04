import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { ADDR, BLOCKS_PER_YEAR, comptrollerAbi, vBnbAbi, type BaseEnv } from "./config";

export interface Clients {
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, PrivateKeyAccount>;
}

export function clients(env: Pick<BaseEnv, "AGENT_PRIVATE_KEY" | "RPC_URL">): Clients {
  const account = privateKeyToAccount(env.AGENT_PRIVATE_KEY as `0x${string}`);
  const transport = http(env.RPC_URL, { batch: true });
  const publicClient = createPublicClient({ chain: bscTestnet, transport, batch: { multicall: true } }) as PublicClient;
  const walletClient = createWalletClient({ chain: bscTestnet, transport, account });
  return { account, publicClient, walletClient };
}

/** The agent wallet's liquid BNB and its Venus vBNB position. */
export interface VenusView {
  agentWallet: Address;
  apyBps: bigint;
  walletWei: bigint;
  vTokenBalance: bigint;
  suppliedWei: bigint;
  mintPaused: boolean;
  redeemPaused: boolean;
}

export async function readVenus(publicClient: PublicClient, agentWallet: Address): Promise<VenusView> {
  const [rate, vTokenBalance, exchangeRate, mintPaused, redeemPaused, walletWei] = await Promise.all([
    publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "supplyRatePerBlock" }),
    publicClient.readContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "balanceOf", args: [agentWallet] }),
    // exchangeRateStored only moves when someone touches the market; simulate exchangeRateCurrent so accrued interest is real.
    publicClient
      .simulateContract({ address: ADDR.vBNB, abi: vBnbAbi, functionName: "exchangeRateCurrent", account: agentWallet })
      .then((r) => r.result),
    publicClient.readContract({ address: ADDR.venusComptroller, abi: comptrollerAbi, functionName: "actionPaused", args: [ADDR.vBNB, 0] }),
    publicClient.readContract({ address: ADDR.venusComptroller, abi: comptrollerAbi, functionName: "actionPaused", args: [ADDR.vBNB, 1] }),
    publicClient.getBalance({ address: agentWallet }),
  ]);
  return {
    agentWallet,
    // Simple annualisation of the per-block supply rate.
    apyBps: (rate * BLOCKS_PER_YEAR * 10_000n) / 10n ** 18n,
    walletWei,
    vTokenBalance,
    suppliedWei: (vTokenBalance * exchangeRate) / 10n ** 18n,
    mintPaused,
    redeemPaused,
  };
}

