// Canary revenue audit — pulls USDC Transfer events from the canary payer wallet
// to the X402_PAYTO address on Base mainnet, confirms balances, and writes a
// posterity ledger of the first real (paid-but-unreceipted) settlements.
import { createPublicClient, http, getAddress, formatUnits, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { writeFileSync, mkdirSync } from "node:fs";

const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913");
const PAYER = getAddress("0x180f6E73f7c866e5fc9547c8a3f5cdE9411904C2");
const PAYTO = getAddress("0xFb8915074cC941f5Ab95E6001c45287b8EeC4427");

const RPCS = [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://base.llamarpc.com",
];

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

async function makeClient() {
  for (const url of RPCS) {
    try {
      const c = createPublicClient({ chain: base, transport: http(url) });
      await c.getBlockNumber();
      console.log("RPC:", url);
      return c;
    } catch {
      // try next
    }
  }
  throw new Error("no working RPC");
}

const balanceAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

async function main() {
  const client = await makeClient();

  const [payerBal, payToBal, latest] = await Promise.all([
    client.readContract({ address: USDC, abi: balanceAbi, functionName: "balanceOf", args: [PAYER] }),
    client.readContract({ address: USDC, abi: balanceAbi, functionName: "balanceOf", args: [PAYTO] }),
    client.getBlockNumber(),
  ]);

  console.log("Payer balance:", formatUnits(payerBal, 6), "USDC");
  console.log("PayTo balance:", formatUnits(payToBal, 6), "USDC");
  console.log("Latest block:", latest.toString());

  // Scan back ~24h of Base blocks (~2s/block => ~43200 blocks) in safe chunks.
  const SPAN = 45000n;
  const CHUNK = 800n;
  const fromStart = latest > SPAN ? latest - SPAN : 0n;

  const logs = [];
  for (let from = fromStart; from <= latest; from += CHUNK + 1n) {
    const to = from + CHUNK > latest ? latest : from + CHUNK;
    try {
      const part = await client.getLogs({
        address: USDC,
        event: transferEvent,
        args: { from: PAYER, to: PAYTO },
        fromBlock: from,
        toBlock: to,
      });
      logs.push(...part);
    } catch (e) {
      // skip chunk on RPC range error
    }
  }

  const settlements = logs
    .map((l) => ({
      txHash: l.transactionHash,
      block: Number(l.blockNumber),
      from: l.args.from,
      to: l.args.to,
      valueUsdc: formatUnits(l.args.value, 6),
      basescan: `https://basescan.org/tx/${l.transactionHash}`,
    }))
    .sort((a, b) => a.block - b.block);

  console.log("\n=== Canary settlements (payer -> payTo) ===");
  console.log("count:", settlements.length);
  for (const s of settlements) {
    console.log(`  ${s.block}  ${s.valueUsdc} USDC  ${s.txHash}`);
  }

  const total = settlements.reduce((acc, s) => acc + Number(s.valueUsdc), 0);
  console.log("total moved:", total.toFixed(2), "USDC");

  const ledger = {
    note: "First real x402 revenue. These canary settlements moved USDC on-chain but the Worker crashed (D1 Promise bind bug, fixed in 6b96c6a) before recording grants or returning receipts. Logged here for posterity — receipts cannot be reissued retroactively.",
    asset: "USDC (Base mainnet)",
    contract: USDC,
    payer: PAYER,
    payTo: PAYTO,
    auditedAt: new Date().toISOString(),
    payerBalanceUsdc: formatUnits(payerBal, 6),
    payToBalanceUsdc: formatUnits(payToBal, 6),
    settlementCount: settlements.length,
    totalUsdc: total.toFixed(2),
    settlements,
  };

  mkdirSync(new URL("../docs/", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("../docs/canary-revenue-ledger.json", import.meta.url),
    JSON.stringify(ledger, null, 2)
  );
  console.log("\nLedger written: docs/canary-revenue-ledger.json");
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e.message);
  process.exit(1);
});
