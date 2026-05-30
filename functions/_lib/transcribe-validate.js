/**
 * transcribe-validate — deterministic validation gate for the transcription door.
 *
 * The model produces a transcript + meaning. This module decides, with NO model
 * calls and NO randomness, whether that output is good enough to charge for and
 * to put a work-mark on. It is the line between "we ran a model" and "we stand
 * behind this output".
 *
 * Four gates, all must pass:
 *   (a) schema      — strict shape check of the structured output
 *   (b) plausibility — non-empty, language present, words/min inside a sane band
 *   (c) loop        — n-gram repetition / decode-loop detection (hallucination)
 *   (d) coverage    — the "meaning" vocabulary overlaps the transcript (grounded,
 *                     not invented)
 *
 * GUARDRAILS LAW: the attestation this produces is EVIDENCE-ONLY. It states what
 * was measured ("schema-valid, words/min in range, no loop, meaning grounded in
 * transcript"). It NEVER claims the transcript is accurate or verified-correct —
 * we did not hear the audio ourselves.
 */

const WPM_MIN = 40; // music / sparse speech / pauses
const WPM_MAX = 400; // fast speech ceiling; above this is almost always a decode artifact
const MIN_WORDS = 5;
const LOOP_NGRAM = 4;
const LOOP_DISTINCT_RATIO_MIN = 0.35; // distinct n-grams / total; below = looping
const LOOP_MAX_SINGLE_REPEAT = 12; // any single n-gram repeated this many times = loop
const COVERAGE_OVERLAP_MIN = 0.45; // share of meaning content-words found in transcript

const STOPWORDS = new Set(
  "a an and the of to in on at for is are was were be been being it its this that these those as by with from or but if then so we you they he she i me my our your their them him her his hers do does did done have has had not no yes will would can could should may might must about into over under than too very just also more most some any each".split(
    " "
  )
);

/**
 * @param {object} structured - parsed structured output from the model.
 * @param {object} [opts]
 * @param {number} [opts.durationSeconds] - media duration if known (audio/video).
 * @returns {{ pass: boolean, failures: Array, evidence: object, attestation_claims: string[] }}
 */
export function validateTranscription(structured, opts = {}) {
  const failures = [];
  const evidence = {};

  // ---- (a) strict schema ----
  const schema = checkSchema(structured);
  evidence.schema_valid = schema.ok;
  if (!schema.ok) {
    for (const m of schema.missing) failures.push({ check: "schema", detail: m });
    // Without a transcript there is nothing else to measure.
    return result(false, failures, evidence);
  }

  const transcript = structured.transcript;
  const words = tokenize(transcript);
  const wordCount = words.length;

  // ---- (b) plausibility ----
  evidence.word_count = wordCount;
  evidence.language = String(structured.language || "").trim() || null;

  if (wordCount < MIN_WORDS) {
    failures.push({ check: "plausibility", detail: `transcript too short (${wordCount} words)` });
  }
  if (!evidence.language) {
    failures.push({ check: "plausibility", detail: "no language detected" });
  }

  const durationSeconds = Number(opts.durationSeconds) > 0 ? Number(opts.durationSeconds) : null;
  evidence.duration_seconds = durationSeconds;
  if (durationSeconds) {
    const wpm = wordCount / (durationSeconds / 60);
    evidence.words_per_minute = Math.round(wpm);
    evidence.wpm_in_range = wpm >= WPM_MIN && wpm <= WPM_MAX;
    if (!evidence.wpm_in_range) {
      failures.push({
        check: "plausibility",
        detail: `words/min ${Math.round(wpm)} outside [${WPM_MIN}, ${WPM_MAX}]`,
      });
    }
  } else {
    evidence.words_per_minute = null;
    evidence.wpm_in_range = null; // not measurable without duration
  }

  // ---- (c) loop / n-gram repetition ----
  const loop = detectLoop(words, LOOP_NGRAM);
  evidence.loop = loop;
  if (loop.looping) {
    failures.push({
      check: "loop",
      detail: `repetition loop detected (distinct ${loop.distinct_ratio}, max repeat ${loop.max_repeat})`,
    });
  }

  // ---- (d) coverage / overlap continuity ----
  const coverage = checkCoverage(transcript, structured);
  evidence.coverage = coverage;
  if (!coverage.grounded) {
    failures.push({
      check: "coverage",
      detail: `meaning overlap ${coverage.overlap_ratio} below ${COVERAGE_OVERLAP_MIN} — summary/key-points not grounded in transcript`,
    });
  }

  return result(failures.length === 0, failures, evidence);
}

function result(pass, failures, evidence) {
  return {
    pass,
    failures,
    evidence,
    attestation_claims: pass ? buildClaims(evidence) : [],
  };
}

/** Evidence-only claims. Never "accurate" / "verified" — only what was measured. */
function buildClaims(evidence) {
  const claims = [];
  if (evidence.schema_valid) claims.push("schema-valid structured output");
  if (evidence.wpm_in_range === true) {
    claims.push(`words/min in range (${evidence.words_per_minute})`);
  } else if (evidence.word_count >= MIN_WORDS) {
    claims.push(`non-empty transcript (${evidence.word_count} words)`);
  }
  if (evidence.loop && evidence.loop.looping === false) claims.push("no repetition loop");
  if (evidence.coverage && evidence.coverage.grounded) {
    claims.push("meaning grounded in transcript");
  }
  return claims;
}

function checkSchema(s) {
  const missing = [];
  if (!s || typeof s !== "object") return { ok: false, missing: ["output is not an object"] };
  if (typeof s.transcript !== "string" || s.transcript.trim().length === 0) {
    missing.push("transcript (non-empty string) required");
  }
  if (typeof s.language !== "string" || s.language.trim().length === 0) {
    missing.push("language (string) required");
  }
  if (typeof s.summary !== "string" || s.summary.trim().length === 0) {
    missing.push("summary (non-empty string) required");
  }
  if (!Array.isArray(s.key_points) || s.key_points.length === 0) {
    missing.push("key_points (non-empty array) required");
  }
  if (!Array.isArray(s.qa)) {
    missing.push("qa (array) required");
  } else {
    const bad = s.qa.some(
      (item) => !item || typeof item.question !== "string" || typeof item.answer !== "string"
    );
    if (bad) missing.push("qa[] entries must be { question, answer } strings");
  }
  return { ok: missing.length === 0, missing };
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function contentWords(words) {
  return words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Decode-loop detection via n-gram diversity + worst-case single n-gram repeat. */
function detectLoop(words, n) {
  if (words.length < n * 3) {
    return { ngram: n, distinct_ratio: 1, max_repeat: 1, looping: false, measurable: false };
  }
  const counts = new Map();
  const total = words.length - n + 1;
  let maxRepeat = 0;
  for (let i = 0; i < total; i++) {
    const gram = words.slice(i, i + n).join(" ");
    const c = (counts.get(gram) || 0) + 1;
    counts.set(gram, c);
    if (c > maxRepeat) maxRepeat = c;
  }
  const distinctRatio = counts.size / total;
  const looping = distinctRatio < LOOP_DISTINCT_RATIO_MIN || maxRepeat >= LOOP_MAX_SINGLE_REPEAT;
  return {
    ngram: n,
    distinct_ratio: round2(distinctRatio),
    max_repeat: maxRepeat,
    looping,
    measurable: true,
  };
}

/** Coverage proxy: do the meaning fields draw on the transcript's vocabulary? */
function checkCoverage(transcript, structured) {
  const transcriptVocab = new Set(contentWords(tokenize(transcript)));
  const meaningText = [
    structured.summary || "",
    ...(Array.isArray(structured.key_points) ? structured.key_points : []),
    ...(Array.isArray(structured.qa) ? structured.qa.map((q) => q?.answer || "") : []),
  ].join(" ");

  const meaningWords = contentWords(tokenize(meaningText));
  if (meaningWords.length === 0) {
    return { overlap_ratio: 0, grounded: false, meaning_words: 0 };
  }
  let hits = 0;
  for (const w of meaningWords) if (transcriptVocab.has(w)) hits++;
  const overlap = hits / meaningWords.length;
  return {
    overlap_ratio: round2(overlap),
    grounded: overlap >= COVERAGE_OVERLAP_MIN,
    meaning_words: meaningWords.length,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Strict JSON Schema for the model's structured output — shared with the route. */
export const TRANSCRIPT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    language: { type: "string", description: "BCP-47-ish language code or name detected in the media" },
    media_kind: { type: "string", enum: ["audio", "pdf", "video"] },
    transcript: { type: "string", description: "Full verbatim transcription (audio/video) or extracted text (PDF)" },
    summary: { type: "string", description: "Concise summary of the content's meaning" },
    key_points: { type: "array", items: { type: "string" }, description: "Salient points, most important first" },
    qa: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
      description: "Anticipated questions about the content and grounded answers",
    },
  },
  required: ["language", "media_kind", "transcript", "summary", "key_points", "qa"],
};
