"""Hugging Face Space for Second Eyes service and package discovery."""
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
                "second-eyes": {
                    "command": "npx",
                    "args": ["-y", "@secondeyes/mcp-unblock@1.2.6"],
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


with gr.Blocks(title="Second Eyes Agent Workflow Services") as demo:
    gr.Markdown(
        """
# Second Eyes Agent Workflow Services

Workflow diagnostics, capability routing, execution evidence, and x402 v2 settlement for MCP-compatible agents.
"""
    )
    status = gr.JSON(label="Live status", value=live_status())
    refresh = gr.Button("Refresh proof + stats")
    refresh.click(live_status, outputs=status)
    gr.Markdown("## Cursor / Claude MCP config")
    gr.Markdown(
        "Current release: `@secondeyes/mcp-unblock@1.2.6` (x402 **v2**). "
        "Institution-managed payment sessions are the production direction; direct wallet signing remains a compatibility mode."
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
