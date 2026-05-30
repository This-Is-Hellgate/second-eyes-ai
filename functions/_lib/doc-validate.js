/**
 * doc-validate — deterministic validation gate for the document-extraction door.
 *
 * The model produces structured data from a PDF/doc. This module decides, with NO
 * model calls and NO randomness, whether that output is good enough to charge for
 * and to put a work-mark on. It is the line between "we ran a model" and "we stand
 * behind this output as reconcilable evidence".
 *
 * Four deterministic gates (all must pass):
 *   (a) schema      — strict shape/type check of the structured output
 *   (b) arithmetic  — line-item amounts sum to subtotal; subtotal + tax == total
 *                     within tolerance (invoice only)
 *   (c) sanity      — dates parse as ISO-8601; currency is a real ISO-4217 code
 *   (d) required    — required fields are present and non-empty
 *
 * GUARDRAILS LAW: the attestation this produces is EVIDENCE-ONLY. It states what
 * was measured ("schema-valid, totals reconcile, dates parse, currency is
 * ISO-4217"). It NEVER claims the document is correct, authentic, or "legally
 * verified" — we did not read the source for legal or financial meaning.
 */

/** Absolute floor for money comparisons (one cent). */
const CENT = 0.01;

/** Active ISO-4217 alphabetic codes (no funds/precious-metal X-codes). */
const ISO_4217 = new Set(
  ("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB " +
    "BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP " +
    "DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG " +
    "HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT " +
    "LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR " +
    "MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB " +
    "RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT " +
    "TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF " +
    "YER ZAR ZMW ZWL").split(/\s+/)
);

/**
 * @param {"invoice"|"contract"|"generic"} docType
 * @param {object} data - parsed structured output from the model.
 * @returns {{ pass: boolean, failures: Array, discrepancy: object|null, evidence: object, attestation_claims: string[] }}
 */
export function validateDoc(docType, data) {
  if (docType === "invoice") return validateInvoice(data);
  if (docType === "contract") return validateContract(data);
  if (docType === "generic") return validateGeneric(data);
  return result(false, [{ check: "schema", detail: `unknown doc_type "${docType}"` }], null, {});
}

// ---------------------------------------------------------------------------
// invoice
// ---------------------------------------------------------------------------

function validateInvoice(d) {
  const failures = [];
  const evidence = {};
  let discrepancy = null;

  // ---- (a) schema ----
  const schema = invoiceSchema(d);
  evidence.schema_valid = schema.ok;
  if (!schema.ok) {
    for (const m of schema.missing) failures.push({ check: "schema", detail: m });
    return result(false, failures, null, evidence);
  }

  // ---- (d) required / non-empty ----
  if (!isNonEmptyString(d.vendor)) failures.push({ check: "required", detail: "vendor is empty" });
  if (!isNonEmptyString(d.buyer)) failures.push({ check: "required", detail: "buyer is empty" });
  if (!Array.isArray(d.line_items) || d.line_items.length === 0) {
    failures.push({ check: "required", detail: "line_items is empty" });
  }

  // ---- (c) currency / date sanity ----
  evidence.currency = String(d.currency || "").toUpperCase();
  if (!ISO_4217.has(evidence.currency)) {
    failures.push({ check: "sanity", detail: `currency "${d.currency}" is not a valid ISO-4217 code` });
  }
  const dates = d.dates || {};
  const dateFields = checkDates({ issue_date: dates.issue_date, due_date: dates.due_date }, ["issue_date"]);
  evidence.dates = dateFields.parsed;
  for (const f of dateFields.failures) failures.push({ check: "sanity", detail: f });

  // ---- (b) arithmetic ----
  // Stop here if the structural pieces needed for arithmetic are missing.
  if (failures.some((f) => f.check === "required" && f.detail === "line_items is empty")) {
    return result(false, failures, discrepancy, evidence);
  }

  const lines = d.line_items;
  const lineTol = CENT + 1e-9;
  const sumTol = Math.max(CENT, lines.length * 0.005) + 1e-9; // accumulated rounding budget
  const totalTol = CENT + 1e-9;

  const lineChecks = [];
  let sumAmounts = 0;
  for (let i = 0; i < lines.length; i++) {
    const li = lines[i];
    const qty = num(li.qty);
    const unit = num(li.unit_price);
    const amount = num(li.amount);
    sumAmounts += amount;
    const expected = round2(qty * unit);
    const ok = Math.abs(expected - amount) <= lineTol;
    lineChecks.push({ index: i, qty, unit_price: unit, amount, expected_amount: expected, ok });
    if (!ok) {
      failures.push({
        check: "arithmetic",
        detail: `line ${i}: qty*unit_price (${expected}) != amount (${amount})`,
      });
    }
  }
  sumAmounts = round2(sumAmounts);

  const subtotal = num(d.subtotal);
  const tax = num(d.tax);
  const total = num(d.total);

  const subtotalOk = Math.abs(sumAmounts - subtotal) <= sumTol;
  const totalOk = Math.abs(round2(subtotal + tax) - total) <= totalTol;

  evidence.arithmetic = {
    line_item_count: lines.length,
    sum_of_line_amounts: sumAmounts,
    stated_subtotal: subtotal,
    subtotal_reconciles: subtotalOk,
    tax,
    expected_total: round2(subtotal + tax),
    stated_total: total,
    total_reconciles: totalOk,
    tolerance: { line: round2(lineTol), subtotal: round2(sumTol), total: round2(totalTol) },
  };

  if (!subtotalOk || !totalOk || lineChecks.some((l) => !l.ok)) {
    discrepancy = {
      line_items: lineChecks,
      subtotal: { sum_of_line_amounts: sumAmounts, stated: subtotal, difference: round2(sumAmounts - subtotal) },
      total: { expected: round2(subtotal + tax), stated: total, difference: round2(round2(subtotal + tax) - total) },
    };
    if (!subtotalOk) {
      failures.push({
        check: "arithmetic",
        detail: `line items sum to ${sumAmounts} but subtotal is ${subtotal} (diff ${round2(sumAmounts - subtotal)})`,
      });
    }
    if (!totalOk) {
      failures.push({
        check: "arithmetic",
        detail: `subtotal + tax = ${round2(subtotal + tax)} but total is ${total} (diff ${round2(round2(subtotal + tax) - total)})`,
      });
    }
  }

  return result(failures.length === 0, failures, discrepancy, evidence);
}

function invoiceSchema(d) {
  const missing = [];
  if (!d || typeof d !== "object") return { ok: false, missing: ["output is not an object"] };
  for (const f of ["vendor", "buyer", "currency"]) {
    if (typeof d[f] !== "string") missing.push(`${f} (string) required`);
  }
  for (const f of ["subtotal", "tax", "total"]) {
    if (!isFiniteNumber(d[f])) missing.push(`${f} (number) required`);
  }
  if (!Array.isArray(d.line_items)) {
    missing.push("line_items (array) required");
  } else {
    const bad = d.line_items.some(
      (li) =>
        !li ||
        typeof li.desc !== "string" ||
        !isFiniteNumber(li.qty) ||
        !isFiniteNumber(li.unit_price) ||
        !isFiniteNumber(li.amount)
    );
    if (bad) missing.push("line_items[] entries must be { desc:string, qty, unit_price, amount:number }");
  }
  if (!d.dates || typeof d.dates !== "object") missing.push("dates (object) required");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------

function validateContract(d) {
  const failures = [];
  const evidence = {};

  const schema = contractSchema(d);
  evidence.schema_valid = schema.ok;
  if (!schema.ok) {
    for (const m of schema.missing) failures.push({ check: "schema", detail: m });
    return result(false, failures, null, evidence);
  }

  if (!Array.isArray(d.parties) || d.parties.filter(isNonEmptyString).length < 2) {
    failures.push({ check: "required", detail: "at least two parties required" });
  }
  if (!isNonEmptyString(d.term)) failures.push({ check: "required", detail: "term is empty" });
  if (!Array.isArray(d.key_clauses) || d.key_clauses.filter(isNonEmptyString).length === 0) {
    failures.push({ check: "required", detail: "key_clauses is empty" });
  }
  if (!Array.isArray(d.obligations)) {
    failures.push({ check: "required", detail: "obligations is missing" });
  }

  const dateCheck = checkDates({ effective_date: d.effective_date }, ["effective_date"]);
  evidence.dates = dateCheck.parsed;
  for (const f of dateCheck.failures) failures.push({ check: "sanity", detail: f });

  evidence.party_count = Array.isArray(d.parties) ? d.parties.filter(isNonEmptyString).length : 0;
  evidence.clause_count = Array.isArray(d.key_clauses) ? d.key_clauses.filter(isNonEmptyString).length : 0;
  evidence.obligation_count = Array.isArray(d.obligations) ? d.obligations.filter(isNonEmptyString).length : 0;

  return result(failures.length === 0, failures, null, evidence);
}

function contractSchema(d) {
  const missing = [];
  if (!d || typeof d !== "object") return { ok: false, missing: ["output is not an object"] };
  if (!Array.isArray(d.parties)) missing.push("parties (array) required");
  if (typeof d.effective_date !== "string") missing.push("effective_date (string) required");
  if (typeof d.term !== "string") missing.push("term (string) required");
  if (!Array.isArray(d.key_clauses)) missing.push("key_clauses (array) required");
  if (!Array.isArray(d.obligations)) missing.push("obligations (array) required");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// generic
// ---------------------------------------------------------------------------

function validateGeneric(d) {
  const failures = [];
  const evidence = {};

  const schema = genericSchema(d);
  evidence.schema_valid = schema.ok;
  if (!schema.ok) {
    for (const m of schema.missing) failures.push({ check: "schema", detail: m });
    return result(false, failures, null, evidence);
  }

  if (!isNonEmptyString(d.title)) failures.push({ check: "required", detail: "title is empty" });
  if (!Array.isArray(d.sections) || d.sections.length === 0) {
    failures.push({ check: "required", detail: "sections is empty" });
  } else {
    const bad = d.sections.some((s) => !s || !isNonEmptyString(s.heading) || typeof s.content !== "string");
    if (bad) failures.push({ check: "schema", detail: "sections[] entries must be { heading:string, content:string }" });
  }

  evidence.section_count = Array.isArray(d.sections) ? d.sections.length : 0;
  evidence.entity_count = Array.isArray(d.entities) ? d.entities.filter(isNonEmptyString).length : 0;

  return result(failures.length === 0, failures, null, evidence);
}

function genericSchema(d) {
  const missing = [];
  if (!d || typeof d !== "object") return { ok: false, missing: ["output is not an object"] };
  if (typeof d.title !== "string") missing.push("title (string) required");
  if (!Array.isArray(d.sections)) missing.push("sections (array) required");
  if (!Array.isArray(d.entities)) missing.push("entities (array) required");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function result(pass, failures, discrepancy, evidence) {
  return {
    pass,
    failures,
    discrepancy: discrepancy || null,
    evidence,
    attestation_claims: pass ? buildClaims(evidence) : [],
  };
}

/** Evidence-only claims. Never "accurate" / "verified" / "legally verified". */
function buildClaims(evidence) {
  const claims = [];
  if (evidence.schema_valid) claims.push("schema-valid structured output");
  if (evidence.arithmetic) {
    if (evidence.arithmetic.subtotal_reconciles) claims.push("line items sum to subtotal");
    if (evidence.arithmetic.total_reconciles) claims.push("subtotal + tax reconciles to total");
  }
  if (evidence.currency && ISO_4217.has(evidence.currency)) {
    claims.push(`currency is ISO-4217 (${evidence.currency})`);
  }
  if (evidence.dates && Object.values(evidence.dates).some((v) => v && v.iso)) {
    claims.push("dates parse as ISO-8601");
  }
  if (Number.isFinite(evidence.party_count) && evidence.party_count >= 2) {
    claims.push(`${evidence.party_count} parties identified`);
  }
  if (Number.isFinite(evidence.section_count) && evidence.section_count > 0) {
    claims.push(`${evidence.section_count} sections extracted`);
  }
  return claims;
}

function checkDates(fields, requiredKeys) {
  const parsed = {};
  const failures = [];
  for (const [key, raw] of Object.entries(fields)) {
    const required = requiredKeys.includes(key);
    const str = typeof raw === "string" ? raw.trim() : "";
    if (!str) {
      parsed[key] = { provided: false, iso: false };
      if (required) failures.push(`${key} is empty`);
      continue;
    }
    const ok = isIsoDate(str);
    parsed[key] = { provided: true, iso: ok, value: str };
    if (!ok) failures.push(`${key} "${str}" is not a parseable ISO-8601 date`);
  }
  return { parsed, failures };
}

/** Strict ISO-8601 calendar date (YYYY-MM-DD, optional time) that is a real day. */
function isIsoDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function num(v) {
  return isFiniteNumber(v) ? v : 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// strict JSON Schemas — shared with the route (OpenRouter response_format)
// ---------------------------------------------------------------------------

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: "string", description: "Seller / issuer of the invoice" },
    buyer: { type: "string", description: "Bill-to party" },
    line_items: {
      type: "array",
      description: "Each billed line",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          desc: { type: "string" },
          qty: { type: "number" },
          unit_price: { type: "number" },
          amount: { type: "number", description: "qty * unit_price for this line" },
        },
        required: ["desc", "qty", "unit_price", "amount"],
      },
    },
    subtotal: { type: "number", description: "Sum of line amounts before tax" },
    tax: { type: "number", description: "Total tax; 0 if none" },
    total: { type: "number", description: "subtotal + tax" },
    currency: { type: "string", description: "ISO-4217 alphabetic code, e.g. USD" },
    dates: {
      type: "object",
      additionalProperties: false,
      properties: {
        issue_date: { type: "string", description: "ISO-8601 YYYY-MM-DD; empty string if unknown" },
        due_date: { type: "string", description: "ISO-8601 YYYY-MM-DD; empty string if none" },
      },
      required: ["issue_date", "due_date"],
    },
  },
  required: ["vendor", "buyer", "line_items", "subtotal", "tax", "total", "currency", "dates"],
};

const CONTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    parties: { type: "array", items: { type: "string" }, description: "Named parties to the agreement" },
    effective_date: { type: "string", description: "ISO-8601 YYYY-MM-DD" },
    term: { type: "string", description: "Duration / termination terms in plain text" },
    key_clauses: { type: "array", items: { type: "string" }, description: "Material clauses, most important first" },
    obligations: { type: "array", items: { type: "string" }, description: "Who must do what" },
  },
  required: ["parties", "effective_date", "term", "key_clauses", "obligations"],
};

const GENERIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          content: { type: "string" },
        },
        required: ["heading", "content"],
      },
    },
    entities: { type: "array", items: { type: "string" }, description: "People, orgs, places, identifiers named in the doc" },
  },
  required: ["title", "sections", "entities"],
};

export const DOC_SCHEMAS = {
  invoice: INVOICE_SCHEMA,
  contract: CONTRACT_SCHEMA,
  generic: GENERIC_SCHEMA,
};

export const DOC_TYPES = Object.freeze(["invoice", "contract", "generic"]);
