/**
 * Shared SSRF guard for endpoints that fetch an agent-supplied URL.
 * Only public https hosts are allowed; private/loopback/link-local ranges blocked.
 */
export function isSafeHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h === "[::1]" || h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const p = h.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return false;
    if (p[0] === 169 && p[1] === 254) return false;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false;
    if (p[0] === 192 && p[1] === 168) return false;
  }
  return true;
}

/**
 * Allowlist of hosts the transcription door may fetch media/PDF from. Beyond SSRF
 * (covered by isSafeHttpUrl), this narrows the surface to platforms whose ToS
 * permit programmatic fetch of public assets, and keeps us off arbitrary origins
 * that could be used to launder abusive content through a paid model call.
 *
 * Suffix match: an entry "example.com" matches example.com and *.example.com.
 */
const MEDIA_HOST_ALLOWLIST = [
  // Object stores / CDNs commonly used to host user media + PDFs
  "amazonaws.com", // s3.* and *.s3.*.amazonaws.com
  "s3.amazonaws.com",
  "blob.core.windows.net",
  "storage.googleapis.com",
  "r2.cloudflarestorage.com",
  "r2.dev",
  "cloudfront.net",
  "digitaloceanspaces.com",
  "backblazeb2.com",
  // Audio / podcast hosts
  "anchor.fm",
  "buzzsprout.com",
  "libsyn.com",
  "simplecast.com",
  "transistor.fm",
  "soundcloud.com",
  "podbean.com",
  "megaphone.fm",
  "art19.com",
  "acast.com",
  // Video (URL passed through to the model; we do not download large video)
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  // Document / PDF hosts
  "arxiv.org",
  "githubusercontent.com",
  "github.io",
  "readthedocs.io",
];

/** YouTube/short-form watch URLs the model can ingest by reference (no download). */
const VIDEO_REF_HOSTS = ["youtube.com", "youtu.be", "vimeo.com"];

function hostMatchesSuffix(hostname, suffixes) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

/**
 * Media/PDF fetch gate. Must pass the base SSRF guard AND be on the allowlist.
 * @returns {boolean}
 */
export function isAllowedMediaUrl(raw) {
  if (!isSafeHttpUrl(raw)) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return hostMatchesSuffix(u.hostname, MEDIA_HOST_ALLOWLIST);
}

/** True for hosts we pass to the model by reference instead of downloading. */
export function isVideoReferenceUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return hostMatchesSuffix(u.hostname, VIDEO_REF_HOSTS);
}

export { MEDIA_HOST_ALLOWLIST };
