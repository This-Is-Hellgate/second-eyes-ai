import { SignJWT, importJWK } from "jose";
import { readFileSync } from "node:fs";

const credsPath = "C:/Users/mchay/OneDrive/Desktop/This is It/cdp-credentials.local.json";
const creds = JSON.parse(readFileSync(credsPath, "utf8"));
const keyName = creds.CDP_API_KEY_NAME;
const keySecret = creds.CDP_API_KEY_SECRET;
console.log("Key name:", keyName);
console.log("Secret length:", keySecret.length);
const binary = atob(keySecret);
console.log("Decoded bytes:", binary.length, "(expected 64)");
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const seed = bytes.subarray(0, 32);
const pub = bytes.subarray(32, 64);
const b64url = b => btoa(String.fromCharCode(...b)).replace(/[+]/g,"-").replace(/[/]/g,"_").replace(/=+$/,"");
const jwk = { kty: "OKP", crv: "Ed25519", d: b64url(seed), x: b64url(pub) };
const key = await importJWK(jwk, "EdDSA");
const HOST = "api.cdp.coinbase.com";
const PATH = "/platform/v2/x402/verify";
const now = Math.floor(Date.now() / 1000);
const nonce = crypto.randomUUID().replace(/-/g,"");
const jwt = await new SignJWT({ sub: keyName, uri: "POST " + HOST + PATH, aud: ["cdp_service"] })
  .setProtectedHeader({ alg: "EdDSA", kid: keyName, typ: "JWT", nonce })
  .setIssuer("cdp").setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 120)
  .sign(key);
console.log("JWT OK");
const res = await fetch("https://" + HOST + PATH, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
  body: JSON.stringify({ x402Version: 2, paymentPayload: { test: true }, paymentRequirements: {} })
});
const body = await res.json().catch(() => ({}));
console.log("CDP status:", res.status);
console.log("CDP body:", JSON.stringify(body, null, 2));
