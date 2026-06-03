/**
 * Cloudflare HTTPAdapter for x402HTTPResourceServer
 *
 * Direct equivalent of adapter.ts (CloudFrontHTTPAdapter) from
 * coinbase/x402/examples/typescript/servers/cloudfront-lambda-edge.
 *
 * Implements the same HTTPAdapter interface methods against a
 * standard Cloudflare Request object instead of CloudFrontRequest.
 */

/**
 * CloudflareHTTPAdapter — implements the HTTPAdapter interface
 * that x402HTTPResourceServer.processHTTPRequest() expects.
 *
 * Methods mirror CloudFrontHTTPAdapter exactly:
 *   getHeader(name)      — case-insensitive header read
 *   getMethod()          — HTTP method
 *   getPath()            — pathname only
 *   getUrl()             — full URL string
 *   getAcceptHeader()    — hardcoded 'application/json' (forces JSON 402)
 *   getUserAgent()       — user-agent header
 *   getQueryParams()     — parsed query parameters
 */
export class CloudflareHTTPAdapter {
  /**
   * @param {Request} request - Cloudflare Request object
   * @param {string} [origin] - Override origin (e.g. canonical host)
   */
  constructor(request, origin) {
    this.request = request;
    this.url = new URL(request.url);
    this.origin = origin || this.url.origin;
  }

  /**
   * Read a request header by name (case-insensitive).
   * Maps to CloudFrontHTTPAdapter.getHeader().
   */
  getHeader(name) {
    return this.request.headers.get(name) || undefined;
  }

  /**
   * HTTP method string.
   * Maps to CloudFrontHTTPAdapter.getMethod().
   */
  getMethod() {
    return this.request.method;
  }

  /**
   * URL pathname only (no query string).
   * Maps to CloudFrontHTTPAdapter.getPath() which returns request.uri.
   */
  getPath() {
    return this.url.pathname;
  }

  /**
   * Full URL string including query parameters.
   * Maps to CloudFrontHTTPAdapter.getUrl() which constructs
   * https://{distributionDomain}{uri}?{querystring}.
   */
  getUrl() {
    return `${this.origin}${this.url.pathname}${this.url.search}`;
  }

  /**
   * Override to always return 'application/json' to prevent browser detection.
   *
   * This ensures x402HTTPResourceServer returns JSON 402 responses instead
   * of HTML paywall. Identical to CloudFrontHTTPAdapter's override — the AWS
   * sample notes that Lambda@Edge responses are limited to 1MB, making HTML
   * paywalls impractical. On Cloudflare Workers we have the same preference:
   * agents and programmatic clients expect JSON, not HTML.
   */
  getAcceptHeader() {
    return "application/json";
  }

  /**
   * User-Agent header value.
   * Maps to CloudFrontHTTPAdapter.getUserAgent().
   */
  getUserAgent() {
    return this.getHeader("user-agent") || "";
  }

  /**
   * Parsed query parameters as a plain object.
   * Maps to CloudFrontHTTPAdapter.getQueryParams() which parses
   * request.querystring into Record<string, string>.
   */
  getQueryParams() {
    const params = {};
    this.url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  }
}
