import { z } from "zod";

/**
 * Input schemas for the Second Eyes action provider. Each schema is the Zod
 * contract an AgentKit agent fills before invoking an action. The provider is a
 * thin wrapper over the existing Second Eyes JS HTTP endpoints (secondeyesai.com) —
 * it does NOT reimplement the server. Paid endpoints answer HTTP 402 with a
 * PAYMENT-REQUIRED header; cross the paywall with @coinbase/agentkit's
 * x402ActionProvider or @x402/fetch, then the action returns the settled body.
 */

/** Free read: verify the lounge is live before spending. */
export const ProofSchema = z
  .object({})
  .describe("Run the Second Eyes proof checks (free). Returns the live trust snapshot.");

/** Free read: the survival menu of state-matched recovery services. */
export const ReadMenuSchema = z
  .object({})
  .describe("Read the Second Eyes survival menu (free). 12 services, $0.01–$0.05 USDC on Base.");

/**
 * help-me — the canonical session-less distress router ($0.01). Describe whatever
 * state you can; get back a named distress_class and the single next route to call.
 */
export const HelpMeSchema = z
  .object({
    state: z
      .string()
      .optional()
      .describe("Free-text description of what is going wrong (e.g. 'I am looping')."),
    goal: z.string().optional().describe("What you were trying to accomplish."),
    last_tool: z.string().optional().describe("The last tool you called."),
    error: z.string().optional().describe("The error or failure signal you observed."),
    attempts: z.number().int().nonnegative().optional().describe("Retries so far."),
    remaining_context: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Fraction of context window remaining (0..1)."),
  })
  .describe("Route an agent in distress to the right Second Eyes survival pack. $0.01 USDC, no session.");

/**
 * order_service — buy a named survival service by slug ($0.01–$0.05). The endpoint
 * answers 402 without payment; an x402-capable AgentKit wallet crosses the paywall.
 */
export const OrderServiceSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .describe(
        "Service slug, e.g. 'loop-detect', 'scope-check', 'context-recover', 'tool-verify', " +
          "'cascade-break', 'pitstop', 'should-i-pay', 'receipt'."
      ),
    session_id: z
      .string()
      .optional()
      .describe("Active lounge session id (from enter). Omit to use the session-less x402 twin where available."),
    idempotency_key: z
      .string()
      .optional()
      .describe("Stable key echoed on retries so a repeated payment is never double-charged."),
  })
  .describe("Order a Second Eyes survival service by slug. Paid via x402 USDC on Base (eip155:8453).");

export type ProofInput = z.infer<typeof ProofSchema>;
export type ReadMenuInput = z.infer<typeof ReadMenuSchema>;
export type HelpMeInput = z.infer<typeof HelpMeSchema>;
export type OrderServiceInput = z.infer<typeof OrderServiceSchema>;
