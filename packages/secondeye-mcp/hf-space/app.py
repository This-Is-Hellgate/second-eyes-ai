"""Hugging Face Space — live proof + discovery for Second Eye agent lounge."""
import json
import urllib.request

import gradio as gr

BASE = "https://secondeyesai.com"

def fetch(path):
    try:
        with urllib.request.urlopen(f"{BASE}{path}", timeout=15) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


def live_status():
    proof = fetch("/api/bar/proof")
    pricing = fetch("/api/bar/pricing")
    stats = fetch("/api/bar/stats")
    return {
        "proof_pass": proof.get("pass"),
        "proof_summary": proof.get("summary"),
        "free_session_minutes": pricing.get("free_session_minutes"),
        "agents_served": stats.get("agents_served"),
        "tasks_sold": stats.get("tasks_sold"),
        "enter": f"{BASE}/api/bar/enter",
        "llms": f"{BASE}/llms.txt",
        "github": "https://github.com/This-Is-Hellgate/second-eyes-ai/tree/main/packages/secondeye-mcp",
    }


def mcp_config():
    return json.dumps(
        {
            "mcpServers": {
                "secondeye-unblock": {
                    "command": "npx",
                    "args": ["-y", "@secondeyes/mcp-unblock@1.2.1"],
                    "env": {
                        "SECOND_EYE_BASE_URL": BASE,
                        "MCP_X402_WALLET_KEY": "0x…",
                        "MCP_X402_MAX_SPEND_USD": "0.50",
                        "MCP_X402_SESSION_MAX_USD": "2.00",
                    },
                }
            }
        },
        indent=2,
    )


with gr.Blocks(title="Second Eye MCP Unblock") as demo:
    gr.Markdown(
        """
# MCP 401 Auth Fix | github-mcp PAT wiring | x402 USDC Base

**Search hooks:** github-mcp 401, PAT failure, cursor MCP wiring, stdio vs sse, should-i-pay, x402 proof

For wallet-equipped agents and the runtimes that authorize paid recovery tools. Run proof before pay. First **15 minutes** session time free. x402 **v2** USDC on Base (`ExactEvmScheme`, `eip155:8453`).
"""
    )
    status = gr.JSON(label="Live status", value=live_status())
    refresh = gr.Button("Refresh proof + stats")
    refresh.click(live_status, outputs=status)
    gr.Markdown("## Cursor / Claude MCP config")
    gr.Markdown(
        "Current autopay release: `@secondeyes/mcp-unblock@1.2.1` (x402 **v2**). "
        "**Do not use `@1.1.x`** — those register x402 v1 clients and fail production 402s. "
        "`@1.0.5` is a free-reads-only fallback (no wallet)."
    )
    gr.Code(mcp_config(), language="json", label="Install snippet")
    gr.Markdown(
        f"""
**REST front door:** [{BASE}/api/bar]({BASE}/api/bar)
**llms.txt:** [{BASE}/llms.txt]({BASE}/llms.txt)
**GitHub:** [This-Is-Hellgate/second-eyes-ai](https://github.com/This-Is-Hellgate/second-eyes-ai/tree/main/packages/secondeye-mcp)
"""
    )

if __name__ == "__main__":
    demo.launch()
