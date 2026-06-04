# FIXME: x402 verify — follow-up work (post-14253d2)

## Context
Commit `14253d2` fixed the x402 verify regression: PR #27 was mutating the buyer's
SIGNED `paymentPayload` (rewriting `resource`, injecting `extensions`) inside
`buildFacilitatorRequestBody` in `functions/_lib/x402.js`. That reshaped the payload
so CDP could classify it as neither `x402V2PaymentPayload` nor `x402V1PaymentPayload`
(HTTP 400, `invalidReason: null`), breaking 100% of settlements from June 2 onward.

The fix passes the signed payload through UNMUTATED. Verified by 8 real on-chain
settlements (HTTP 200, real grant IDs + tx hashes) across aws-agent-survival, help-me,
peril-router, payment-confirmation-check, schema-repair, context-pressure, loop-detect,
bazaar-index-check. (x402-doctor failed only on insufficient funds — wallet drained to
$0.02 after ~$0.22 of settlements — NOT a code bug; same code path as the 8 successes.)

The items below are SEPARATE, NON-BLOCKING follow-ups. Payments work in production now.

---

## 1. CI test cleanup  [RESOLVED 2026-06-04, commits 356a3a2 + decode fix] — `test/x402-facilitator/mocked.test.mjs`
The mocked test is currently RED because it still asserts PR #27's reverted behavior
(full description + extensions injected into the signed payload). It must be updated to
assert the CORRECT contract. TWO blocks need updating, not one:

- **Loop block at ~line 317** ("object-from-header / string-only / resource-omitted"):
  should assert the builder passes the decoded signed payload through unmutated, does
  NOT inject `extensions`, and that `paymentRequirements` is the clean v2 per-accept
  shape (scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra — no resource,
  no description).
- **Signed-url block at ~line 359** ("buyer's SIGNED resource URL is preserved"): also
  asserts old full-description behavior (`facilitator full description (signed-url)`).
  Same treatment — assert pass-through, not re-derivation.

Empirically confirmed contract after the fix (use these as the assertion targets):
  - `built.body.paymentPayload` deep-equals the decoded input payload (no mutation).
  - `built.body.paymentPayload.extensions === undefined` (builder injects nothing).
  - `built.body.paymentRequirements` = clean v2 shape; no `resource`/`description` keys.
  - Full/untruncated description does NOT reach CDP via verify OR settle anymore — and
    that is correct: the May-31 working state (16 settlements, 5 cataloged) also did not
    inject full metadata. Bazaar cataloging rides the PAYMENT-REQUIRED header / 402 body
    (asserted separately, ~lines 275-302, which are correct and stay).

CAUTION (cost me a wrong assumption mid-session): do NOT compare the output payload
against a separately re-stringified expected object. `parsePaymentPayloadFromHeader`
decodes via `atob`, which mangles multibyte UTF-8 (see #2). A naive `eqJson` against a
`Buffer.from(...).toString("utf8")` expectation produces a FALSE mismatch on the
description's em-dash/ellipsis. Compare structurally, or compare the resource the buyer
sent vs the resource that came out via the SAME decode path.

## 2. Pre-existing UTF-8 decode bug  [RESOLVED 2026-06-04 — fixed in code, not worked around] — `parsePaymentPayloadFromHeader` (x402.js ~line 333)
It decodes base64 with `atob(...)`, then `JSON.parse`. `atob` yields a binary string and
does NOT correctly decode multibyte UTF-8 — so any non-ASCII in `resource.description`
(em-dash, ellipsis, accents) is corrupted before it reaches CDP.

- Impact: cosmetic/cataloging only. Does NOT affect settlement — signature, authorization,
  network, scheme, amount are all ASCII, which is why all 8 payments settled fine.
- Fix direction: decode UTF-8 properly, e.g.
  `JSON.parse(Buffer.from(b64, "base64").toString("utf8"))` (Workers: use `TextDecoder`
  over the `atob` byte array). Verify against the official @x402 client's encoder.
- This is its OWN change with its OWN test. Do NOT bundle it with the test cleanup in #1.

---
## RESOLUTION (2026-06-04)
Both items are now fixed in code, not deferred:
- #1: mocked.test.mjs rewritten to assert the pass-through-unmutated contract (both
  verify-body blocks) plus a multibyte round-trip regression guard. Test exits 0.
- #2: added decodeBase64Json() in x402.js — the exact UTF-8 inverse of the encoder
  (atob -> Uint8Array -> TextDecoder). Rewired parsePaymentPayloadFromHeader AND
  parseExtensionResponses. Proven lossless on em-dash/ellipsis/accents/CJK; identical
  behavior for ASCII, so existing consumers (stripe-x402, x402-payment-log) are
  unaffected. The test no longer needs the same-decode-path workaround.

Written end of session 2026-06-04 after the 14253d2 fix was deployed and proven.
