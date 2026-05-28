import { SignJWT, importPKCS8 } from "jose";

const CDP_HOST = "api.cdp.coinbase.com";

/** CDP Secret API key JWT — valid ~2 minutes per request. */
export async function buildCdpAuthHeaders(env, method, requestPath) {
  const keyName = env.CDP_API_KEY_NAME || env.CDP_API_KEY_ID;
  const keySecret = env.CDP_API_KEY_SECRET;

  if (keyName && keySecret) {
    const uri = `${method.toUpperCase()} ${CDP_HOST}${requestPath}`;
    const pem = keySecret.includes("\\n") ? keySecret.replace(/\\n/g, "\n") : keySecret;
    const key = await importPKCS8(pem, "ES256");
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID().replace(/-/g, "");

    const jwt = await new SignJWT({ sub: keyName, uri })
      .setProtectedHeader({ alg: "ES256", kid: keyName, nonce })
      .setIssuer("cdp")
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + 120)
      .sign(key);

    return { Authorization: `Bearer ${jwt}` };
  }

  if (env.CDP_API_KEY) {
    return { Authorization: `Bearer ${env.CDP_API_KEY}` };
  }

  return {};
}

export function facilitatorPaths(baseUrl) {
  const base = baseUrl.replace(/\/$/, "");
  const suffix = base.endsWith("/platform") ? "/v2/x402" : "/platform/v2/x402";
  return {
    verifyPath: `${suffix}/verify`,
    settlePath: `${suffix}/settle`,
  };
}
