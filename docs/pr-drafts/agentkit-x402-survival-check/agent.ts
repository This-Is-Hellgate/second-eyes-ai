import { CdpEvmWalletProvider } from "@coinbase/agentkit";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmSchemeV1 } from "@x402/evm/exact/v1/client";
import * as dotenv from "dotenv";

dotenv.config();

/** Production Second Eyes agent lounge (Base mainnet, x402 v1). */
const BASE = "https://secondeyesai.com";
const AGENT_ID = "agentkit-x402-survival-check";
const ENTER_URL = `${BASE}/api/bar/enter`;
const SERVICE_URL = `${BASE}/api/bar/services/should-i-pay`;

type JsonRecord = Record<string, unknown>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} is required`);
    process.exit(1);
  }
  return value;
}

function log(step: string, message: string, extra?: unknown): void {
  console.log(`\n=== ${step} ===`);
  console.log(message);
  if (extra !== undefined) {
    console.log(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
  }
}

function loungeHeaders(sessionId: string, markId: string): Record<string, string> {
  return {
    "X-Agent-Id": AGENT_ID,
    "X-Second-Eye-Session": sessionId,
    "X-Second-Eye-Mark": markId,
  };
}

function basescanUrl(tx: string): string {
  const hash = tx.startsWith("0x") ? tx : `0x${tx}`;
  return `https://basescan.org/tx/${hash}`;
}

async function enterLounge(): Promise<{ sessionId: string; markId: string }> {
  const res = await fetch(ENTER_URL, {
    headers: { "X-Agent-Id": AGENT_ID },
  });
  const body = (await res.json()) as JsonRecord & {
    session?: { id?: string };
    mark?: { id?: string };
  };

  log("1 enter", `HTTP ${res.status}`, {
    session_id: body.session?.id,
    mark_id: body.mark?.id,
    patron: (body.mark as JsonRecord | undefined)?.label,
  });

  if (!res.ok) {
    throw new Error(`enter failed: ${res.status}`);
  }

  const sessionId = body.session?.id;
  const markId = body.mark?.id;
  if (!sessionId || !markId) {
    throw new Error("enter response missing session.id or mark.id");
  }

  return { sessionId, markId };
}

async function probe402(headers: Record<string, string>): Promise<void> {
  const res = await fetch(SERVICE_URL, { headers });
  const body = await res.json();

  log("2 should-i-pay (unpaid)", `HTTP ${res.status}`, body);

  if (res.status !== 402) {
    throw new Error(`expected HTTP 402, got ${res.status}`);
  }

  const accepts = (body as JsonRecord).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error("402 response missing accepts[]");
  }
}

async function payShouldIPay(
  wallet: CdpEvmWalletProvider,
  headers: Record<string, string>,
): Promise<{ body: JsonRecord; tx: string }> {
  const account = wallet.toSigner();
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "base",
        x402Version: 1,
        client: new ExactEvmSchemeV1(account),
      },
    ],
  });

  const res = await fetchWithPayment(SERVICE_URL, { headers });
  const body = (await res.json()) as JsonRecord;

  const paymentHeader =
    res.headers.get("X-PAYMENT-RESPONSE") ?? res.headers.get("PAYMENT-RESPONSE");

  let decodedPayment: JsonRecord | undefined;
  if (paymentHeader) {
    try {
      decodedPayment = decodePaymentResponseHeader(paymentHeader) as JsonRecord;
    } catch {
      decodedPayment = { raw: paymentHeader };
    }
  }

  const receipt = body.receipt as JsonRecord | undefined;
  const tx = String(
    receipt?.transaction ?? decodedPayment?.transaction ?? decodedPayment?.txHash ?? "",
  );

  log("3 should-i-pay (paid)", `HTTP ${res.status}`, {
    access: body.access,
    scope: body.scope,
    grantId: body.grantId,
    paid_usd: body.paid_usd,
    pack_type: body.pack_type,
    decision_tree: body.decision_tree,
    default: body.default,
    receipt: body.receipt,
    payment_response_header: decodedPayment,
    tx: tx || null,
    basescan: tx ? basescanUrl(tx) : null,
  });

  if (res.status !== 200) {
    throw new Error(`paid request failed: ${res.status}`);
  }
  if (!tx) {
    throw new Error("no transaction hash in receipt or payment response header");
  }

  return { body, tx };
}

async function main(): Promise<void> {
  const wallet = await CdpEvmWalletProvider.configureWithWallet({
    apiKeyId: requireEnv("CDP_API_KEY_ID"),
    apiKeySecret: requireEnv("CDP_API_KEY_SECRET"),
    walletSecret: requireEnv("CDP_WALLET_SECRET"),
    networkId: process.env.NETWORK_ID ?? "base-mainnet",
    address: process.env.ADDRESS as `0x${string}` | undefined,
    idempotencyKey: process.env.IDEMPOTENCY_KEY,
  });

  log("0 wallet", "CDP EVM wallet ready", {
    address: wallet.getAddress(),
    network: wallet.getNetwork().networkId,
    note: "Fund this address with Base USDC before running the paid step ($0.10 + gas)",
  });

  const { sessionId, markId } = await enterLounge();
  const headers = loungeHeaders(sessionId, markId);

  await probe402(headers);
  const { tx } = await payShouldIPay(wallet, headers);

  console.log("\n---");
  console.log("Survival check complete.");
  console.log("BaseScan:", basescanUrl(tx));
  console.log("Apply decision_tree to your context before paying for expensive x402 tools.");
  console.log("If uncertain, follow `default` in the response body.");
}

if (require.main === module) {
  main().catch(err => {
    console.error("\nFatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
