#!/usr/bin/env node
/**
 * Apply Second Eye D1 seeds (ontology, relationships, taxonomy, signals, validator policy).
 * Usage: node scripts/seed-d1.mjs [--remote]
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const remote = process.argv.includes("--remote");
const ts = new Date().toISOString();

function load(name) {
  return JSON.parse(readFileSync(join(root, "seeds", name), "utf8"));
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function makeId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function runSql(sql) {
  const file = join(tmpdir(), `seed-d1-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(file, sql, "utf8");
  try {
    const remoteFlag = remote ? "--remote" : "";
    const cmd = `npx wrangler d1 execute second-eyes-lawful-loop ${remoteFlag} --file "${file}" --json -y`;
    const result = spawnSync(cmd, { encoding: "utf8", cwd: root, shell: true });
    if (result.status !== 0) {
      console.error(result.stdout || result.stderr);
      throw new Error("D1 execute failed");
    }
    return result.stdout;
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function mergePolicy(base, existing, synthesis) {
  const robot = new Set([
    ...(base.creative_waistline?.robot_phrases || []),
    ...(existing.creative_waistline?.robot_phrases || []),
  ]);
  return {
    ...base,
    ...existing,
    source_validation: { ...base.source_validation, ...existing.source_validation },
    creative_waistline: {
      ...base.creative_waistline,
      ...existing.creative_waistline,
      robot_phrases: [...robot],
    },
    learning_rule: { ...base.learning_rule, ...existing.learning_rule },
    synthesis: synthesis.synthesis,
    beat_templates: synthesis.beat_templates,
  };
}

const ontology = load("ontology-expansion.json");
const signals = load("signals-citations.json");
const synthesis = load("synthesis-policy.json");
const policyBase = load("validator-policy-base.json");

const statements = [];
const receipts = [];

function addReceipt(sourceId, action, targetTable, targetId) {
  receipts.push(
    `INSERT OR IGNORE INTO writer_receipts (id, source_id, action, target_table, target_id, created_at) VALUES ('${makeId("wrt")}', '${sqlEscape(sourceId)}', '${action}', '${sqlEscape(targetTable)}', '${sqlEscape(targetId)}', '${ts}');`
  );
}

for (const e of ontology.entities) {
  statements.push(
    `INSERT OR IGNORE INTO ontology_entities (id, name, entity_type, source_id, created_at, updated_at) VALUES ('${sqlEscape(e.id)}', '${sqlEscape(e.name)}', '${sqlEscape(e.entity_type)}', '${sqlEscape(e.source_id)}', '${ts}', '${ts}');`
  );
  addReceipt(e.source_id, "bootstrap_entity", "ontology_entities", e.id);
}

for (const r of ontology.relationships) {
  statements.push(
    `INSERT OR IGNORE INTO relationships (id, source_entity_id, target_entity_id, relationship_type, source_id, created_at) VALUES ('${sqlEscape(r.id)}', '${sqlEscape(r.source_entity_id)}', '${sqlEscape(r.target_entity_id)}', '${sqlEscape(r.relationship_type)}', '${sqlEscape(r.source_id)}', '${ts}');`
  );
  addReceipt(r.source_id, "bootstrap_relationship", "relationships", r.id);
}

for (const t of ontology.taxonomy_extensions || []) {
  statements.push(
    `INSERT OR IGNORE INTO taxonomy_nodes (id, name, parent_id, created_at) VALUES ('${sqlEscape(t.id)}', '${sqlEscape(t.name)}', '${sqlEscape(t.parent_id)}', '${ts}');`
  );
  addReceipt("system_seed", "bootstrap_taxonomy", "taxonomy_nodes", t.id);
}

for (const s of signals.signals) {
  const meta = sqlEscape(s.metadata || "{}");
  const raw = sqlEscape(s.raw_text || "");
  const url = sqlEscape(s.source_url || "");
  const src = sqlEscape(s.source || "human_seed");
  const status = sqlEscape(s.status || "approved");
  statements.push(
    `INSERT OR IGNORE INTO signals (id, source_url, raw_text, status, created_at, updated_at, metadata, source) VALUES ('${sqlEscape(s.id)}', '${url}', '${raw}', '${status}', strftime('%s','now'), strftime('%s','now'), '${meta}', '${src}');`
  );
  let sourceId = "system_seed";
  try {
    const metaObj = JSON.parse(s.metadata || "{}");
    if (metaObj.source_id) sourceId = metaObj.source_id;
  } catch {
    /* ignore */
  }
  addReceipt(sourceId, "bootstrap_signal", "signals", s.id);
}

const policyRow = runSql("SELECT value FROM validator_policy WHERE key = 'policy';");
let existing = {};
try {
  const parsed = JSON.parse(policyRow);
  const value = parsed?.[0]?.results?.[0]?.value;
  if (value) existing = JSON.parse(value);
} catch {
  existing = {};
}

const merged = mergePolicy(policyBase, existing, synthesis);
const mergedJson = sqlEscape(JSON.stringify(merged));
statements.push(
  `UPDATE validator_policy SET value = '${mergedJson}', updated_at = '${ts}' WHERE key = 'policy';`
);

const missionSourceIds = [
  "src_4fcd1fc86038142f",
  "src_03b9b2f390abdf68",
  "src_276fbac03e25d81b",
  "src_e00a19c56af34d29",
  "src_f6ac22af8f054397",
  "src_d8303122e7732530",
  "src_be3f12566d1c9760",
];
for (const id of missionSourceIds) {
  statements.push(`UPDATE submitted_sources SET status = 'recorded' WHERE id = '${id}' AND status = 'approved';`);
}

statements.push(...receipts);

console.log(`Applying ${statements.length} seed statements (${remote ? "remote" : "local"})...`);

const chunkSize = 10;
for (let i = 0; i < statements.length; i += chunkSize) {
  const chunk = statements.slice(i, i + chunkSize).join("\n");
  runSql(chunk);
  process.stdout.write(".");
}

console.log("\nSeed apply complete.");
console.log(
  `Entities: ${ontology.entities.length}, Relationships: ${ontology.relationships.length}, Signals: ${signals.signals.length}, Receipts: ${receipts.length}`
);
