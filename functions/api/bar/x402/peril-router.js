/**
 * /api/bar/x402/peril-router — legacy technical alias for /api/bar/x402/help-me.
 *
 * help-me is the canonical broad agent-distress door (looping, drifting,
 * cascading errors, context collapse, token pressure, tool/MCP failure,
 * uncertainty, payment hesitation — 402 is only one of these). peril-router is
 * kept for backwards compatibility with agents and indexes that discovered the
 * older route name; it delegates to the exact same handlers so the two never
 * diverge. New discovery surfaces point at help-me.
 *
 * Same price ($0.01), same input fields, same session-less x402 routing.
 *
 *   GET  /api/bar/x402/peril-router?state=I+am+looping&error=same+401&failure_count=3
 *   POST /api/bar/x402/peril-router  { "state":"…","goal":"…","error":"…" }
 */

export {
  onRequestOptions,
  onRequestGet,
  onRequestPost,
} from "./help-me.js";
