/**
 * Known operator/test payer wallets — used to distinguish self-settlements
 * (our own canary/operator wallets) from genuine external agent payers.
 *
 * The default set is the wallets that have provably moved USDC on this paywall
 * during bring-up: the canary payer and the lounge payTo. They are public on
 * Base already (see docs/canary-revenue-ledger.json), so listing them here adds
 * no new disclosure. Operators extend the set without a redeploy via the
 * KNOWN_TEST_PAYERS env var (comma/space/newline-separated 0x addresses).
 *
 * Anything NOT in this set that settles a payment is treated as an EXTERNAL
 * agent payer — the signal this module exists to surface.
 */

// Canary payer wallet (scripts/canary-pay.mjs, docs/canary-revenue-ledger.json).
const CANARY_PAYER = "0x180f6E73f7c866e5fc9547c8a3f5cdE9411904C2";
// Lounge receive wallet (X402_PAYTO during bring-up). A settlement whose
// payer_ref is the payTo itself is a self-transfer / sweep, never an external buyer.
const LOUNGE_PAYTO = "0xFb8915074cC941f5Ab95E6001c45287b8EeC4427";

const DEFAULT_KNOWN_PAYERS = [CANARY_PAYER, LOUNGE_PAYTO];

/** Normalize an on-chain ref to a stable comparison key (lowercased, trimmed). */
export function normalizePayer(ref) {
  if (typeof ref !== "string") return null;
  const v = ref.trim().toLowerCase();
  return v.length ? v : null;
}

/** Mask a wallet ref the same way the public ledger does (0x1234…cdef). */
export function maskPayer(ref) {
  if (!ref || ref.length < 12) return null;
  return `${ref.slice(0, 6)}…${ref.slice(-4)}`;
}

/**
 * Build the set of known operator/test payers for this environment.
 * Defaults always include our canary + payTo; env additions are merged in.
 * Pass { includeDefaults: false } (or set KNOWN_TEST_PAYERS_STRICT=1) to use
 * ONLY the env-provided list — useful for tests that want full control.
 */
export function getKnownPayers(env = {}, { includeDefaults } = {}) {
  const strict =
    includeDefaults === false ||
    String(env.KNOWN_TEST_PAYERS_STRICT || "").trim() === "1";

  const fromEnv = String(env.KNOWN_TEST_PAYERS || "")
    .split(/[\s,]+/)
    .map(normalizePayer)
    .filter(Boolean);

  const seed = strict ? [] : DEFAULT_KNOWN_PAYERS.map(normalizePayer);
  return new Set([...seed, ...fromEnv]);
}

/** True when payer_ref belongs to a known operator/test wallet. */
export function isKnownPayer(ref, env = {}, opts) {
  const key = normalizePayer(ref);
  if (!key) return false;
  return getKnownPayers(env, opts).has(key);
}

export { DEFAULT_KNOWN_PAYERS };
