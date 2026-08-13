const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export function validatePaperCodePackage(pkg) {
  const failures = [];
  if (!pkg || typeof pkg !== "object") failures.push("output must be an object");
  if (!pkg?.repository || typeof pkg.repository !== "object") failures.push("repository metadata is required");
  if (!Array.isArray(pkg?.files) || pkg.files.length === 0) failures.push("files must be a non-empty array");
  if (!Array.isArray(pkg?.implementation_plan) || pkg.implementation_plan.length === 0) failures.push("implementation_plan must be non-empty");
  if (!Array.isArray(pkg?.assumptions)) failures.push("assumptions must be an array");
  if (!Array.isArray(pkg?.source_grounding) || pkg.source_grounding.length === 0) failures.push("source_grounding must be non-empty");

  const seen = new Set();
  let sourceFiles = 0;
  let testFiles = 0;
  let totalChars = 0;
  for (const file of pkg?.files || []) {
    if (!file || typeof file !== "object") {
      failures.push("every file must be an object");
      continue;
    }
    const path = String(file.path || "");
    const content = String(file.content || "");
    if (!path || !SAFE_PATH.test(path)) failures.push(`unsafe or missing file path: ${path || "<empty>"}`);
    if (seen.has(path)) failures.push(`duplicate file path: ${path}`);
    seen.add(path);
    if (!content.trim()) failures.push(`empty file content: ${path || "<unknown>"}`);
    totalChars += content.length;
    if (/\.(?:js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|kt|cpp|c|h|hpp)$/i.test(path) && !/(?:test|spec)/i.test(path)) sourceFiles++;
    if (/(?:^|\/)(?:test|tests|spec|specs)(?:\/|$)|(?:\.test\.|\.spec\.)/i.test(path)) testFiles++;
  }

  if (sourceFiles === 0) failures.push("repository must contain at least one implementation source file");
  if (testFiles === 0) failures.push("repository must contain at least one test file");
  if (totalChars > 180000) failures.push("repository package exceeds 180000 characters");

  return {
    pass: failures.length === 0,
    failures,
    evidence: {
      file_count: Array.isArray(pkg?.files) ? pkg.files.length : 0,
      source_file_count: sourceFiles,
      test_file_count: testFiles,
      total_characters: totalChars,
      unique_paths: seen.size,
    },
    attestation_claims: failures.length === 0
      ? ["repository package schema-valid", "safe unique paths", "implementation source present", "tests present", "source-grounding notes present"]
      : [],
  };
}
