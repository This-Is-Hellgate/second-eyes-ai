(() => {
  const cfg = JSON.stringify(
    {
      mcpServers: {
        "secondeye-unblock": {
          command: "npx",
          args: ["-y", "@secondeyes/mcp-unblock"],
          env: { SECOND_EYE_BASE_URL: "https://secondeyesai.com" },
        },
      },
    },
    null,
    2
  );
  const inputs = [...document.querySelectorAll("input,textarea")];
  const box =
    inputs.find((el) => {
      const ph = el.getAttribute("placeholder") || "";
      const name = el.getAttribute("name") || "";
      return ph.includes("Server Config") || name.toLowerCase().includes("config");
    }) || inputs[2];
  if (!box) return "not found: " + inputs.length;
  box.focus();
  box.value = cfg;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
  return cfg.slice(0, 80);
})();
