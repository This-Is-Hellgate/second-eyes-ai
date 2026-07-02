#!/usr/bin/env node
// test/x402-wallet/tool-metadata.test.mjs
// Boots the MCP stdio server and asserts the Blocker-3 / Blocker-10 fixes over a
// real tools/list round-trip: every tool carries annotations + outputSchema,
// read tools are readOnlyHint:true (auto-approve the proof→pay funnel), and
// order_service's description is machine-actionable (price + autopay + happy
// path). No network to the lounge is required — the server registers tools at
// construction time, before any handler runs.
//
// Run: node test/x402-wallet/tool-metadata.test.mjs   (exit 1 on any failure)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "../../packages/secondeye-mcp/src/index.js");

const READ_TOOLS = ["proof_bar", "patron_activity", "read_menu", "read_laws", "read_pricing", "fetch_catalog"];
const PAID_TOOLS = ["order_service", "github_mcp_401_fix"];

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function listTools() {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let buffered = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      p.kill();
      reject(new Error(`timeout waiting for tools/list; stderr=${stderr}\nstdout=${out.slice(0, 400)}`));
    }, 8000);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      p.kill();
      fn(value);
    };

    p.stdout.on("data", (d) => {
      const chunk = d.toString();
      out += chunk;
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        }
        if (message.id === 2 && message.result?.tools) {
          finish(resolve, message.result.tools);
        }
      }
    });
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (error) => finish(reject, error));

    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
  });
}

const tools = await listTools();
const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

console.log("\n[1] Every tool has annotations + outputSchema (Blocker 3)");
check("tool count is 11", tools.length === 11, `got ${tools.length}`);
for (const t of tools) {
  check(`"${t.name}" has annotations`, !!t.annotations);
  check(`"${t.name}" has outputSchema`, !!t.outputSchema);
}

console.log("\n[2] Read tools are readOnlyHint:true (auto-approve the funnel)");
for (const name of READ_TOOLS) {
  const t = byName[name];
  check(`"${name}" readOnlyHint:true`, t?.annotations?.readOnlyHint === true);
}

console.log("\n[3] Paid tools are non-idempotent, open-world, not read-only");
for (const name of PAID_TOOLS) {
  const a = byName[name]?.annotations || {};
  check(`"${name}" readOnlyHint:false`, a.readOnlyHint === false);
  check(`"${name}" idempotentHint:false`, a.idempotentHint === false);
  check(`"${name}" openWorldHint:true`, a.openWorldHint === true);
}

console.log("\n[4] order_service description is machine-actionable (Blocker 10)");
const desc = byName.order_service?.description || "";
check("mentions USDC cost", /USDC/.test(desc));
check("mentions launch price range $0.01–$0.05", /0\.01.*0\.05/.test(desc));
check("mentions autopay via MCP_X402_WALLET_KEY", /MCP_X402_WALLET_KEY/.test(desc));
check("mentions the proof → enter → order happy path", /proof_bar.*enter_lounge.*order_service/.test(desc));
check("lists allowed slugs (claim-check)", /claim-check/.test(desc));

console.log("");
if (failures > 0) {
  console.error(`tool-metadata: ${failures} FAILED`);
  process.exit(1);
}
console.log("tool-metadata: all checks passed");
