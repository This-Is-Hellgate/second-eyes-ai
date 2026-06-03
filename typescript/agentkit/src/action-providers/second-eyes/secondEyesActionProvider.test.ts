import { describe, it, expect, vi } from "vitest";
import { secondEyesActionProvider, SecondEyesActionProvider } from "./secondEyesActionProvider";

/**
 * Unit tests for the Second Eyes AgentKit action provider. They stub fetch so no
 * network is required, and assert the wrapper hits the right Second Eyes JS HTTP
 * endpoints, surfaces 402 PAYMENT-REQUIRED for paid routes, and reads the
 * PAYMENT-RESPONSE receipt header on success.
 */

function mockFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("secondEyesActionProvider", () => {
  it("factory returns a SecondEyesActionProvider", () => {
    expect(secondEyesActionProvider()).toBeInstanceOf(SecondEyesActionProvider);
  });

  it("supports EVM networks (Base settlement)", () => {
    const p = secondEyesActionProvider();
    expect(p.supportsNetwork({ protocolFamily: "evm" } as never)).toBe(true);
    expect(p.supportsNetwork({ protocolFamily: "svm" } as never)).toBe(false);
  });

  it("proof hits /api/bar/proof (free)", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://secondeyesai.com/api/bar/proof");
      return jsonResponse({ pass: true });
    });
    const p = secondEyesActionProvider({ fetchImpl });
    const out = JSON.parse(await p.proof());
    expect(out.status).toBe(200);
    expect(out.body.pass).toBe(true);
  });

  it("readMenu hits /api/bar/menu", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://secondeyesai.com/api/bar/menu");
      return jsonResponse({ items: [] });
    });
    const p = secondEyesActionProvider({ fetchImpl });
    const out = JSON.parse(await p.readMenu());
    expect(out.status).toBe(200);
  });

  it("helpMe POSTs the distress payload to /api/bar/x402/help-me", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://secondeyesai.com/api/bar/x402/help-me");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ state: "I am looping" });
      return jsonResponse({ distress_class: "loop_detected" });
    });
    const p = secondEyesActionProvider({ fetchImpl });
    const out = JSON.parse(await p.helpMe({ state: "I am looping" }));
    expect(out.body.distress_class).toBe("loop_detected");
  });

  it("orderService surfaces a 402 PAYMENT-REQUIRED for an unpaid call", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://secondeyesai.com/api/bar/services/loop-detect");
      return jsonResponse({ error: "Payment required" }, 402, {
        "PAYMENT-REQUIRED": "eyJ4NDAyVmVyc2lvbiI6Mn0=",
      });
    });
    const p = secondEyesActionProvider({ fetchImpl });
    const out = JSON.parse(await p.orderService({ slug: "loop-detect" }));
    expect(out.status).toBe(402);
    expect(out.payment_required).toBe(true);
    expect(out.paymentRequiredHeader).toBe("eyJ4NDAyVmVyc2lvbiI6Mn0=");
  });

  it("orderService forwards session + idempotency headers and reads PAYMENT-RESPONSE on success", async () => {
    const fetchImpl = mockFetch((url, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Second-Eye-Session"]).toBe("sess_1");
      expect(headers["Idempotency-Key"]).toBe("idem_1");
      return jsonResponse({ access: "granted" }, 200, { "PAYMENT-RESPONSE": "cmVjZWlwdA==" });
    });
    const p = secondEyesActionProvider({ fetchImpl });
    const out = JSON.parse(
      await p.orderService({ slug: "loop-detect", session_id: "sess_1", idempotency_key: "idem_1" })
    );
    expect(out.status).toBe(200);
    expect(out.paymentResponse).toBe("cmVjZWlwdA==");
    expect(out.body.access).toBe("granted");
  });

  it("respects a custom baseUrl", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://staging.example/api/bar/proof");
      return jsonResponse({ ok: true });
    });
    const p = secondEyesActionProvider({ baseUrl: "https://staging.example", fetchImpl });
    await p.proof();
  });
});
