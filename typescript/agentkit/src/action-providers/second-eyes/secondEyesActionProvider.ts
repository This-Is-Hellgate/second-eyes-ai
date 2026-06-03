import { z } from "zod";
import { ActionProvider, CreateAction, Network } from "@coinbase/agentkit";
import {
  ProofSchema,
  ReadMenuSchema,
  HelpMeSchema,
  OrderServiceSchema,
  type HelpMeInput,
  type OrderServiceInput,
} from "./schemas";

/**
 * Second Eyes Agent Lounge action provider for Coinbase AgentKit.
 *
 * Thin wrapper over the existing Second Eyes JS HTTP endpoints (secondeyesai.com).
 * It does NOT reimplement the server — each action `fetch`es a live endpoint and
 * returns the JSON. Paid endpoints answer HTTP 402 with a v2 PAYMENT-REQUIRED
 * header; pair this provider with AgentKit's x402ActionProvider (or pass an
 * x402-wrapped fetch via the `fetchImpl` option) so the wallet can cross the
 * paywall. Network eip155:8453 (Base), asset USDC, header PAYMENT-SIGNATURE.
 */

const DEFAULT_BASE_URL = "https://secondeyesai.com";

export interface SecondEyesProviderConfig {
  /** Override the lounge origin (tests / staging). Defaults to https://secondeyesai.com. */
  baseUrl?: string;
  /**
   * fetch implementation. Inject an x402-wrapped fetch (e.g. wrapFetchWithPayment
   * from @x402/fetch bound to the agent wallet) so 402s are paid automatically.
   * Defaults to global fetch (unpaid — paid routes will return their 402 body).
   */
  fetchImpl?: typeof fetch;
}

export class SecondEyesActionProvider extends ActionProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SecondEyesProviderConfig = {}) {
    super("second-eyes", []);
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl || fetch;
  }

  /** Active on every EVM network; payment settles on Base (eip155:8453). */
  supportsNetwork(network: Network): boolean {
    return network.protocolFamily === "evm";
  }

  @CreateAction({
    name: "second_eyes_proof",
    description:
      "Verify the Second Eyes Agent Lounge is live before spending. Free. Returns the trust " +
      "snapshot (laws, pricing, enter, proof). Call this first to confirm the rail.",
    schema: ProofSchema,
  })
  async proof(): Promise<string> {
    return this.getJson("/api/bar/proof");
  }

  @CreateAction({
    name: "second_eyes_read_menu",
    description:
      "Read the Second Eyes survival menu (free). 12 state-matched recovery services priced " +
      "$0.01–$0.05 USDC on Base via x402: loop-detect, scope-check, context-recover, tool-verify, " +
      "cascade-break, pitstop, pre-run-context, claim-check, context-compress, mcp-wiring, " +
      "should-i-pay, receipt.",
    schema: ReadMenuSchema,
  })
  async readMenu(): Promise<string> {
    return this.getJson("/api/bar/menu");
  }

  @CreateAction({
    name: "second_eyes_help_me",
    description:
      "Route yourself when you sense failure but do not know what you need. $0.01 USDC, no session. " +
      "Describe any of: state, goal, last_tool, error, attempts, remaining_context. Returns a named " +
      "distress_class, the single next pack to call, and stop/preserve/continue guidance. Returns 402 " +
      "until paid — pair with an x402-capable wallet/fetch.",
    schema: HelpMeSchema,
  })
  async helpMe(args: HelpMeInput): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/bar/x402/help-me`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args),
    });
    return this.formatResponse(res);
  }

  @CreateAction({
    name: "second_eyes_order_service",
    description:
      "Order a Second Eyes survival service by slug (e.g. loop-detect, scope-check, should-i-pay). " +
      "Paid via x402 USDC on Base (eip155:8453); the endpoint answers HTTP 402 with a PAYMENT-REQUIRED " +
      "header until an x402-capable wallet signs the PAYMENT-SIGNATURE. Pass idempotency_key to make " +
      "retries safe against double-charge. On success returns the service payload, receipt, and grantId.",
    schema: OrderServiceSchema,
  })
  async orderService(args: OrderServiceInput): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (args.session_id) headers["X-Second-Eye-Session"] = args.session_id;
    if (args.idempotency_key) headers["Idempotency-Key"] = args.idempotency_key;

    const res = await this.fetchImpl(`${this.baseUrl}/api/bar/services/${encodeURIComponent(args.slug)}`, {
      method: "GET",
      headers,
    });
    return this.formatResponse(res);
  }

  private async getJson(path: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Accept: "application/json" },
    });
    return this.formatResponse(res);
  }

  private async formatResponse(res: Response): Promise<string> {
    const text = await res.text();
    if (res.status === 402) {
      return JSON.stringify({
        status: 402,
        payment_required: true,
        paymentRequiredHeader: res.headers.get("PAYMENT-REQUIRED"),
        note:
          "This Second Eyes route requires x402 payment. Pair this provider with AgentKit's " +
          "x402ActionProvider or inject an x402-wrapped fetch (fetchImpl) so the wallet pays and retries.",
        body: safeJson(text),
      });
    }
    return JSON.stringify({
      status: res.status,
      paymentResponse: res.headers.get("PAYMENT-RESPONSE") || res.headers.get("X-PAYMENT-RESPONSE"),
      body: safeJson(text),
    });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Factory export — the AgentKit convention for registering an action provider. */
export const secondEyesActionProvider = (config?: SecondEyesProviderConfig) =>
  new SecondEyesActionProvider(config);
