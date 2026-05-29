#!/usr/bin/env node
/** Purge Cloudflare edge cache for agent discovery files on secondeyesai.com */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cfgPath = join(homedir(), ".wrangler", "config", "default.toml");
const cfgText = readFileSync(cfgPath, "utf8");
const tokenMatch = cfgText.match(/^oauth_token\s*=\s*"([^"]+)"/m);
const token = tokenMatch?.[1];
if (!token) throw new Error(`oauth_token not found in ${cfgPath}`);

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors || json));
  return json.result;
}

const zones = await cf("/zones?name=secondeyesai.com");
const zoneId = zones[0]?.id;
if (!zoneId) throw new Error("zone not found");

const files = [
  "https://secondeyesai.com/llms.txt",
  "https://secondeyesai.com/robots.txt",
  "https://secondeyesai.com/.well-known/mcp.json",
  "https://secondeyesai.com/.well-known/agent-card.json",
  "https://secondeyesai.com/.well-known/mcp/server-card.json",
  "https://secondeyesai.com/.well-known/menu.json",
];

const result = await cf(`/zones/${zoneId}/purge_cache`, {
  method: "POST",
  body: JSON.stringify({ files }),
});

console.log(JSON.stringify({ zoneId, purged: files, result }, null, 2));
