// READ-ONLY. Lists ALL incoming USDC transfers to the payTo wallet on Base
// mainnet between a start timestamp and now. Does NOT write any files.
import { createPublicClient, http, getAddress, formatUnits, parseAbiItem } from "viem";
import { base } from "viem/chains";

const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913");
const PAYTO = getAddress("0xFb8915074cC941f5Ab95E6001c45287b8EeC4427");
const CANARY = getAddress("0x180f6E73f7c866e5fc9547c8a3f5cdE9411904C2");
const SINCE_ISO = "2026-05-29T04:56:00Z";
const SINCE_MS = Date.parse(SINCE_ISO);

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
      console.error("RPC:", url);
      return c;
    } catch {}
  }
  throw new Error("no working RPC");
}

const client = await makeClient();
const latest = await client.getBlockNumber();
// ~2s/block on Base. now - 04:56 is < 8h => ~14400 blocks. Use 18000 margin.
const fromStart = latest - 18000n;

const errors = [];
const logs = [];
const CHUNK = 800n;
for (let from = fromStart; from <= latest; from += CHUNK + 1n) {
  const to = from + CHUNK > latest ? latest : from + CHUNK;
  try {
    const part = await client.getLogs({
      address: USDC,
      event: transferEvent,
      args: { to: PAYTO },
      fromBlock: from,
      toBlock: to,
    });
    logs.push(...part);
  } catch (e) {
    errors.push({ from: from.toString(), to: to.toString(), err: e.shortMessage || e.message });
  }
}

// Resolve block timestamps (dedup blocks)
const blockNums = [...new Set(logs.map((l) => l.blockNumber))];
const tsByBlock = new Map();
for (const bn of blockNums) {
  const b = await client.getBlock({ blockNumber: bn });
  tsByBlock.set(bn, Number(b.timestamp) * 1000);
}

const rows = logs
  .map((l) => {
    const tsMs = tsByBlock.get(l.blockNumber);
    return {
      txHash: l.transactionHash,
      block: Number(l.blockNumber),
      from: getAddress(l.args.from),
      amountUsdc: formatUnits(l.args.value, 6),
      timestamp: new Date(tsMs).toISOString(),
      tsMs,
    };
  })
  .filter((r) => r.tsMs >= SINCE_MS)
  .sort((a, b) => a.block - b.block);

console.log("\n=== ALL incoming USDC transfers to payTo since " + SINCE_ISO + " ===");
console.log("payTo:", PAYTO);
console.log("scan range blocks:", fromStart.toString(), "->", latest.toString());
console.log("chunk errors:", errors.length);
if (errors.length) console.log(JSON.stringify(errors, null, 2));
console.log("matching transfers:", rows.length);

for (const r of rows) {
  const isCanary = r.from.toLowerCase() === CANARY.toLowerCase();
  console.log(
    JSON.stringify({
      txHash: r.txHash,
      block: r.block,
      from: r.from,
      amountUsdc: r.amountUsdc,
      timestamp: r.timestamp,
      isCanaryWallet: isCanary,
      basescan: `https://basescan.org/tx/${r.txHash}`,
    })
  );
}

const total = rows.reduce((a, r) => a + Number(r.amountUsdc), 0);
console.log("\ntotal received in window:", total.toFixed(6), "USDC");

const byFrom = {};
for (const r of rows) byFrom[r.from] = (byFrom[r.from] || 0) + Number(r.amountUsdc);
console.log("by from address:");
for (const [addr, amt] of Object.entries(byFrom)) {
  console.log(`  ${addr}  ${amt.toFixed(6)} USDC  ${addr.toLowerCase() === CANARY.toLowerCase() ? "(CANARY)" : "(NOT canary)"}`);
}
