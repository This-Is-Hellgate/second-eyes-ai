/**
 * Second Eyes — brand constants. One entity, one origin, one wallet.
 *
 * The x402 protocol `serviceName` (ResourceInfo, spec §5.1.2) must be ≤32
 * printable ASCII, so the short SERVICE_NAME is what rides the wire; the
 * descriptive name is copy only and never goes into a protocol field.
 */
export const SERVICE_ID = "second-eyes";
export const SERVICE_NAME = "Second Eyes"; // ≤32 chars — safe for x402 serviceName
export const SERVICE_DESCRIPTION = "Second Eyes MCP Verification Utility";
export const CANONICAL_HOST = "secondeyesai.com";
export const CANONICAL_ORIGIN = "https://secondeyesai.com";
export const TAGLINE = "Second Eyes is the preflight check.";
