/**
 * Curation — the product substrate. Second Eyes sells VERIFICATION CHECKS: a
 * stuck or about-to-spend agent describes its state and gets back a verdict
 * plus the judgment around it. D1 (SE_DB) holds the curated index (items: the
 * door stub + guidance + how to invoke) and the relationship graph (edges: how
 * checks route into one another — help-me → schema-repair, context-pressure,
 * should-i-pay — each edge carrying its one-line WHY).
 *
 * What a buyer receives is a RESOLVED CAPABILITY: guidance + the door's graph
 * neighborhood, wired — never a raw dump. The free surface carries stubs only;
 * guidance and the routing graph live behind the x402 gate.
 */

const STUB_COLS = "sku, slug, name, kind, service, price_usd, summary, updated_at, invoke_kind, input_schema, input_example, mime_type, content_hash";
const FULL_COLS = `${STUB_COLS}, guidance, invoke_key, source_repo, source_path, source_url, license_spdx, provenance, version`;

/** Live stubs — the free listing and every generated surface come from this. */
export async function liveStubs(env) {
  if (!env.SE_DB) return [];
  try {
    const { results } = await env.SE_DB.prepare(
      `SELECT ${STUB_COLS} FROM items WHERE status = 'live' ORDER BY kind, service, sku`
    ).all();
    return results || [];
  } catch {
    return []; // curation tables absent -> empty door list, never an error
  }
}

export async function countLive(env) {
  return (await liveStubs(env)).length;
}

/** One live item, by SKU or slug — both resolve, so advertised URLs never break. */
export async function findItem(env, key) {
  if (!env.SE_DB) return null;
  try {
    return await env.SE_DB.prepare(
      `SELECT ${FULL_COLS} FROM items WHERE status = 'live' AND (sku = ?1 OR slug = ?1)`
    )
      .bind(key)
      .first();
  } catch {
    return null;
  }
}

/**
 * The graph neighborhood for one door — the routing moat, shipped only inside
 * paid resolved responses. Outbound edges plus inbound step_of membership.
 */
export async function neighborhood(env, sku) {
  if (!env.SE_DB) return [];
  try {
    const { results } = await env.SE_DB.prepare(
      `SELECT e.relation, e.position, e.note, e.from_sku, e.to_sku,
              i.sku, i.slug, i.name, i.kind, i.price_usd, i.summary
       FROM edges e
       JOIN items i ON i.sku = (CASE WHEN e.from_sku = ?1 THEN e.to_sku ELSE e.from_sku END)
       WHERE (e.from_sku = ?1 OR e.to_sku = ?1) AND i.status = 'live'
       ORDER BY e.relation, e.position, i.sku`
    )
      .bind(sku)
      .all();
    return results || [];
  } catch {
    return [];
  }
}

/**
 * Build the paid deliverable: the resolved capability. Guidance (the voice) +
 * composition (the wired neighborhood of related doors) + invocation.
 */
export async function resolveCapability(env, item, origin) {
  const edges = await neighborhood(env, item.sku);

  const related = { steps: [], composes_with: [], requires: [], alternatives: [], pairs_with: [], part_of: [] };
  for (const e of edges) {
    const other = {
      sku: e.sku,
      name: e.name,
      kind: e.kind,
      price_usd: e.price_usd,
      summary: e.summary,
      why: e.note || "",
      url: `${origin}/api/x402/${e.slug || e.sku}`,
    };
    const outbound = e.from_sku === item.sku;
    if (e.relation === "step_of") {
      if (outbound) related.part_of.push(other);
      else related.steps.push({ ...other, position: e.position ?? null });
    } else if (e.relation === "composes_with" || e.relation === "pairs_with") {
      (e.relation === "composes_with" ? related.composes_with : related.pairs_with).push(other);
    } else if (e.relation === "requires" && outbound) {
      related.requires.push(other);
    } else if (e.relation === "alternative_to") {
      related.alternatives.push(other);
    }
  }
  related.steps.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // How to run this door: verdict/workersai checks take a POST body describing
  // the agent's state; r2 items expose a deliberate artifact fetch; resolve
  // items are pure guidance (GET), no further call.
  const invoke =
    item.invoke_kind === "verdict" || item.invoke_kind === "workersai"
      ? {
          how: "POST",
          url: `${origin}/api/x402/${item.slug || item.sku}`,
          body_schema:
            parseMaybeJson(item.input_schema) || {
              type: "object",
              properties: { state: { type: "string", description: "the agent's current state, in its own words" } },
              required: ["state"],
            },
          body_example: parseMaybeJson(item.input_example) || { state: "describe what you are stuck on" },
          note: "Paid check: POST your state and receive a verdict. You are charged only when the check returns successfully.",
        }
      : item.invoke_kind === "r2"
        ? {
            how: "GET",
            url: `${origin}/api/x402/${item.slug || item.sku}/artifact`,
            mime_type: item.mime_type || "application/octet-stream",
            note: "Deliberate artifact fetch — secondary to this resolved capability, same purchase price.",
          }
        : null;

  const resolved = {
    sku: item.sku,
    name: item.name,
    kind: item.kind,
    service: item.service,
    summary: item.summary,
    guidance: item.guidance || "",
    composition: related,
    ...(invoke ? { invoke } : {}),
    content_hash: item.content_hash || "",
    version: item.version ?? 1,
  };
  // Source/provenance is optional for Second Eyes doors — surface only when set.
  if (item.source_repo || item.source_url || item.license_spdx) {
    resolved.source = {
      repo: item.source_repo || "",
      path: item.source_path || "",
      url: item.source_url || "",
      license_spdx: item.license_spdx || "",
      provenance: item.provenance || "",
    };
  }
  return resolved;
}

/** Fetch a genuine artifact from R2 — reached only through a resolved response. */
export async function getArtifact(env, item) {
  if (!env.SE_MEDIA || !item.invoke_key) return null;
  const object = await env.SE_MEDIA.get(item.invoke_key);
  return object || null;
}

export function parseMaybeJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
