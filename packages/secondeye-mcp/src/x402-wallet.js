/**
 * x402 compatibility wallet bridge for MCP order_service.
 *
 * Env (see README threat model):
 *   MCP_X402_WALLET_KEY — 0x-prefixed EVM private key (preferred)
 *   CANARY_WALLET_KEY   — fallback alias for canary / CI
 *   MCP_X402_MAX_SPEND_USD — per-call cap (default 0.50)
 *   MCP_X402_SESSION_MAX_USD — process lifetime cap (default 2.00)
 *   MCP_X402_ALLOW_SLUGS — comma-separated slugs (or "*"). Default (unset) =
 *     every zero-argument capability slug in CAPABILITY_PRICES_USD that
 *     order_service can call without extra input. The two refinery products
 *     require a caller-supplied URL, so they remain priced and routable but are
 *     excluded from zero-argument autopay by default.
 */
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export const CAPABILITY_PRICES_USD = {
  "loop-detect": 0.03,
  "scope-check": 0.03,
  "context-recover": 0.05,
  "tool-verify": 0.01,
  "cascade-break": 0.05,
  pitstop: 0.03,
  "pre-run-context": 0.03,
  "claim-check": 0.03,
  "context-compress": 0.03,
  "mcp-wiring": 0.05,
  "should-i-pay": 0.01,
  receipt: 0.03,
  "help-me": 0.01,
  "schema-repair": 0.03,
  "analyze-video-audio-and-pdfs": 0.05,
  "turn-paper-into-code": 0.05,
};

export const CAPABILITY_PRICE_MAX_USD = Math.max(...Object.values(CAPABILITY_PRICES_USD));

export const INPUT_REQUIRED_SLUGS = new Set([
  "analyze-video-audio-and-pdfs",
  "turn-paper-into-code",
]);

export const ZERO_ARG_AUTOPAY_SLUGS = Object.keys(CAPABILITY_PRICES_USD).filter(
  (slug) => !INPUT_REQUIRED_SLUGS.has(slug)
);

export function x402RouteSlug(slug) {
  if (!(slug in CAPABILITY_PRICES_USD)) return null;
  return slug;
}

export function x402ServicePath(slug) {
  const routeSlug = x402RouteSlug(slug);
  return routeSlug ? `/api/bar/x402/${routeSlug}` : null;
}

const NETWORK = "eip155:8453";
const DEFAULT_MAX_CALL_USD = 0.5;
const DEFAULT_SESSION_MAX_USD = 2.0;

let sessionSpendUsd = 0;
let cachedAccount = null;
let cachedFetchWithPayment = null;
let walletLoadError = null;

function envNum(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function normalizePrivateKey(raw) {
  if (!raw || typeof raw !== "string") return null;
  const k = raw.trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(k)) return null;
  return k.startsWith("0x") ? k : `0x${k}`;
}

export function parseAllowSlugs() {
  const raw = process.env.MCP_X402_ALLOW_SLUGS;
  if (raw === undefined || raw === null || !raw.trim() || raw.trim() === "*") {
    return new Set(ZERO_ARG_AUTOPAY_SLUGS);
  }
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function loadWallet() {
  if (cachedAccount || walletLoadError) return;
  const key = normalizePrivateKey(process.env.MCP_X402_WALLET_KEY || process.env.CANARY_WALLET_KEY);
  if (!key) return;
  try {
    cachedAccount = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: base, transport: http() });
    const signer = toClientEvmSigner(cachedAccount, publicClient);
    const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
    cachedFetchWithPayment = wrapFetchWithPayment(fetch, client);
  } catch (err) {
    walletLoadError = err instanceof Error ? err.message : String(err);
  }
}

export function walletStatus() {
  loadWallet();
  return {
    configured: Boolean(cachedAccount),
    address: cachedAccount?.address ?? null,
    load_error: walletLoadError,
    session_spend_usd: sessionSpendUsd,
    max_call_usd: envNum("MCP_X402_MAX_SPEND_USD", DEFAULT_MAX_CALL_USD),
    session_max_usd: envNum("MCP_X402_SESSION_MAX_USD", DEFAULT_SESSION_MAX_USD),
    catalog_max_usd: CAPABILITY_PRICE_MAX_USD,
    allow_slugs: [...parseAllowSlugs()],
    allow_slugs_env: process.env.MCP_X402_ALLOW_SLUGS?.trim() || null,
    allow_slugs_default: !process.env.MCP_X402_ALLOW_SLUGS?.trim(),
    x402_version: 2,
    network: NETWORK,
  };
}

export function priceFrom402(json, slug) {
  const fromProduct = json?.product?.priceUsd;
  if (typeof fromProduct === "number" && fromProduct > 0) return fromProduct;
  const catalog = CAPABILITY_PRICES_USD[slug];
  if (typeof catalog === "number") return catalog;
  const accept = json?.accepts?.[0];
  if (accept?.amount) return Number(accept.amount) / 1_000_000;
  if (accept?.maxAmountRequired) return Number(accept.maxAmountRequired) / 1_000_000;
  return null;
}

export function guardPayment(slug, priceUsd) {
  const allow = parseAllowSlugs();
  if (!allow.has(slug)) {
    return {
      ok: false,
      code: "slug_not_allowed",
      message: `Slug "${slug}" not in MCP_X402_ALLOW_SLUGS`,
    };
  }

  const maxCall = envNum("MCP_X402_MAX_SPEND_USD", DEFAULT_MAX_CALL_USD);
  if (priceUsd === null || priceUsd <= 0) {
    return { ok: false, code: "unknown_price", message: "Could not determine 402 price from response" };
  }
  if (priceUsd > maxCall) {
    return {
      ok: false,
      code: "per_call_cap_exceeded",
      message: `Service price $${priceUsd} exceeds MCP_X402_MAX_SPEND_USD ($${maxCall})`,
    };
  }

  const sessionMax = envNum("MCP_X402_SESSION_MAX_USD", DEFAULT_SESSION_MAX_USD);
  if (sessionSpendUsd + priceUsd > sessionMax) {
    return {
      ok: false,
      code: "session_cap_exceeded",
      message: `Would exceed MCP_X402_SESSION_MAX_USD ($${sessionMax}); spent $${sessionSpendUsd} this session`,
    };
  }

  const catalogMax = CAPABILITY_PRICES_USD[slug];
  if (catalogMax !== undefined && priceUsd > catalogMax + 0.001) {
    return {
      ok: false,
      code: "price_mismatch",
      message: `402 quoted $${priceUsd} but catalog max for ${slug} is $${catalogMax}`,
    };
  }

  return { ok: true, priceUsd };
}

export async function payAndRetryService(url, { session_id, slug, initial402 }) {
  loadWallet();

  if (walletLoadError) {
    return {
      status: 402,
      json: initial402,
      x402_error: {
        code: "malformed_wallet_key",
        message: walletLoadError,
        hint: "Fix MCP_X402_WALLET_KEY — expect 0x + 64 hex chars",
      },
    };
  }

  if (!cachedFetchWithPayment || !cachedAccount) {
    return {
      status: 402,
      json: initial402,
      x402_error: {
        code: "no_wallet_configured",
        message: "Payment required but no wallet key in MCP server env",
        hint: "Set MCP_X402_WALLET_KEY on the MCP server process (not the LLM). Or pay via REST with PAYMENT-SIGNATURE.",
        wallet: walletStatus(),
      },
    };
  }

  const priceUsd = priceFrom402(initial402, slug);
  const guard = guardPayment(slug, priceUsd);
  if (!guard.ok) {
    return {
      status: 402,
      json: initial402,
      x402_error: {
        code: guard.code,
        message: guard.message,
        wallet: { address: cachedAccount.address, session_spend_usd: sessionSpendUsd },
      },
    };
  }

  try {
    const res = await cachedFetchWithPayment(url, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Second-Eye-Session": session_id,
      },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text, status: res.status };
    }

    const paymentHeader =
      res.headers.get("X-PAYMENT-RESPONSE") || res.headers.get("PAYMENT-RESPONSE");
    let payment;
    if (paymentHeader) {
      try {
        payment = decodePaymentResponseHeader(paymentHeader);
      } catch (e) {
        payment = { decode_error: String(e), raw: paymentHeader };
      }
    }

    if (res.status === 200) {
      sessionSpendUsd += guard.priceUsd;
      return {
        status: res.status,
        json,
        headers: res.headers,
        payment: {
          paid_usd: guard.priceUsd,
          payer: cachedAccount.address,
          session_spend_usd: sessionSpendUsd,
          decoded_header: payment,
          transaction:
            json?.receipt?.transaction ||
            payment?.transaction ||
            payment?.txHash ||
            payment?.tx ||
            null,
        },
      };
    }

    if (res.status === 402) {
      return {
        status: 402,
        json,
        x402_error: {
          code: "payment_retry_still_402",
          message: "Wallet signed payment but server still returned 402",
          payer: cachedAccount.address,
        },
      };
    }

    return {
      status: res.status,
      json,
      x402_error: {
        code: "payment_verify_failed",
        message: `Paid retry returned HTTP ${res.status}`,
        payer: cachedAccount.address,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = /insufficient|balance|funds/i.test(msg)
      ? "insufficient_funds"
      : /fetch|network|ECONNREFUSED|timeout/i.test(msg)
        ? "network_error"
        : /payment|402|verify|settle/i.test(msg)
          ? "x402_verify_failure"
          : "payment_error";

    return {
      status: 402,
      json: initial402,
      x402_error: {
        code,
        message: msg,
        payer: cachedAccount.address,
      },
    };
  }
}
