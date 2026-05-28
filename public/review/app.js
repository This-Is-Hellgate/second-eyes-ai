const STORAGE_KEY = "second-eye-review-token";
const state = {
  token: "",
  items: [],
  filtered: [],
  selectedId: null,
  filter: "all",
  loading: false,
  deciding: false,
  queueTotal: 0,
  detailRequest: 0,
};

const els = {
  authGate: document.getElementById("auth-gate"),
  app: document.getElementById("app"),
  tokenInput: document.getElementById("token-input"),
  tokenSave: document.getElementById("token-save"),
  queueList: document.getElementById("queue-list"),
  queueCount: document.getElementById("queue-count"),
  positionLabel: document.getElementById("position-label"),
  detailEmpty: document.getElementById("detail-empty"),
  detailCard: document.getElementById("detail-card"),
  toast: document.getElementById("toast"),
  filters: document.querySelector(".filters"),
};

init();

function init() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  const saved = sessionStorage.getItem(STORAGE_KEY);
  state.token = urlToken || saved || "";

  if (urlToken) {
    sessionStorage.setItem(STORAGE_KEY, urlToken);
    params.delete("token");
    const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", clean);
  }

  if (state.token) {
    showApp();
    loadQueue();
  } else {
    els.authGate.hidden = false;
  }

  els.tokenSave.addEventListener("click", saveToken);
  els.tokenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveToken();
  });

  els.queueList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    selectItem(button.dataset.id);
  });

  els.filters.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    for (const node of els.filters.querySelectorAll(".chip")) {
      node.setAttribute("aria-pressed", node === chip ? "true" : "false");
    }
    applyFilter();
  });

  document.addEventListener("keydown", onKeyDown);
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return target.matches("textarea, input, select, [contenteditable='true']");
}

function saveToken() {
  const value = els.tokenInput.value.trim();
  if (!value) return;
  state.token = value;
  sessionStorage.setItem(STORAGE_KEY, value);
  els.authGate.hidden = true;
  showApp();
  loadQueue();
}

function showApp() {
  els.app.hidden = false;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 401) {
    sessionStorage.removeItem(STORAGE_KEY);
    state.token = "";
    els.app.hidden = true;
    els.authGate.hidden = false;
    throw new Error("Invalid review token.");
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data;
}

async function loadQueue() {
  state.loading = true;
  renderQueue();

  try {
    const data = await api("/api/review/queue?status=open&limit=200");
    state.items = data.items || [];
    state.queueTotal = data.total ?? state.items.length;
    els.queueCount.textContent = String(state.queueTotal);
    applyFilter();

    if (!state.selectedId && state.filtered.length) {
      selectItem(state.filtered[0].id);
    } else if (state.selectedId && !state.filtered.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.filtered[0]?.id || null;
      if (state.selectedId) selectItem(state.selectedId);
      else renderDetail(null);
    }
  } catch (error) {
    showToast(error.message);
    renderError(error.message);
  } finally {
    state.loading = false;
    renderQueue();
  }
}

function applyFilter() {
  if (state.filter === "all") {
    state.filtered = [...state.items];
  } else if (state.filter === "worth_a_look" || state.filter === "likely_skip") {
    state.filtered = state.items.filter((item) => item.tier === state.filter);
  } else if (state.filter === "article") {
    state.filtered = state.items.filter((item) =>
      ["article", "arxiv", "design-tool"].includes(item.kind)
    );
  } else {
    state.filtered = state.items.filter((item) => item.kind === state.filter);
  }
  renderQueue();
  updatePositionLabel();
}

function renderQueue() {
  els.queueList.replaceChildren();

  if (state.loading) {
    const li = document.createElement("li");
    li.className = "loading-state";
    li.textContent = "Loading queue…";
    els.queueList.appendChild(li);
    return;
  }

  if (!state.filtered.length) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "No open items in this filter.";
    els.queueList.appendChild(li);
    return;
  }

  for (const item of state.filtered) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "queue-item";
    button.dataset.id = item.id;
    button.setAttribute("aria-current", item.id === state.selectedId ? "true" : "false");

    const top = document.createElement("div");
    top.className = "queue-item-top";

    const title = document.createElement("p");
    title.className = "queue-title";
    title.textContent = item.title || item.url;

    const badgeRow = document.createElement("div");
    badgeRow.className = "badge-row";

    const tierBadge = document.createElement("span");
    tierBadge.className = `tier-badge tier-${item.tier || "review_carefully"}`;
    tierBadge.textContent = item.tierLabel || "Review carefully";

    const badge = document.createElement("span");
    badge.className = `badge ${item.kind || "url"}`;
    badge.textContent = labelForKind(item.kind);

    badgeRow.appendChild(tierBadge);
    badgeRow.appendChild(badge);

    top.appendChild(title);
    top.appendChild(badgeRow);

    const meta = document.createElement("p");
    meta.className = "queue-meta";
    meta.textContent = `${item.supplyLabel || "Agent supply"} · ${formatWhen(item.createdAt)}`;

    button.appendChild(top);
    button.appendChild(meta);
    li.appendChild(button);
    els.queueList.appendChild(li);
  }
}

async function selectItem(id) {
  state.selectedId = id;
  const requestId = ++state.detailRequest;
  renderQueue();
  updatePositionLabel();

  els.detailEmpty.hidden = true;
  els.detailCard.hidden = false;
  els.detailCard.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "loading-state";
  loading.textContent = "Loading detail…";
  els.detailCard.appendChild(loading);

  try {
    const detail = await api(`/api/review/${encodeURIComponent(id)}`);
    if (requestId !== state.detailRequest || state.selectedId !== id) return;
    renderDetail(detail);
  } catch (error) {
    if (requestId !== state.detailRequest) return;
    renderError(error.message);
  }
}

function renderDetail(detail) {
  els.detailCard.replaceChildren();
  if (!detail) {
    els.detailEmpty.hidden = false;
    els.detailCard.hidden = true;
    return;
  }

  const header = document.createElement("div");
  header.className = "detail-header";

  const title = document.createElement("h2");
  title.textContent = detail.title || titleFromUrl(detail.url);

  const tierBadge = document.createElement("span");
  tierBadge.className = `tier-badge tier-${detail.tier || "review_carefully"}`;
  tierBadge.textContent = detail.tierLabel || "Review carefully";

  header.append(title, tierBadge);

  const url = document.createElement("p");
  url.className = "detail-url";
  const link = document.createElement("a");
  link.href = detail.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = detail.url;
  url.appendChild(link);

  const reason = document.createElement("section");
  reason.className = "reason-box";
  const reasonHeading = document.createElement("h3");
  reasonHeading.textContent = "Why the agent queued this";
  const reasonText = document.createElement("p");
  reasonText.textContent = detail.reasonLabel;
  reason.appendChild(reasonHeading);
  reason.appendChild(reasonText);

  if (detail.detail?.reason) {
    const extra = document.createElement("p");
    extra.textContent = detail.detail.reason;
    reason.appendChild(extra);
  }

  const meta = document.createElement("section");
  meta.className = "meta-grid";
  const metaHeading = document.createElement("h3");
  metaHeading.textContent = "Provenance";
  const dl = document.createElement("dl");
  appendMetaRow(dl, "Type", labelForKind(detail.kind));
  appendMetaRow(dl, "Supply", detail.supplyLabel || "Agent supply");
  appendMetaRow(dl, "Channel", detail.channel || "unknown");
  appendMetaRow(dl, "Queued", formatWhen(detail.submittedAt || detail.createdAt));
  appendMetaRow(dl, "Status", detail.status);
  meta.append(metaHeading, dl);

  els.detailCard.append(header, url, reason, meta);

  const preview = detail.signal?.rawText || detail.detail?.summary || "";
  if (preview) {
    const content = document.createElement("section");
    content.className = "content-box";
    const contentHeading = document.createElement("h3");
    contentHeading.textContent = "Extracted content";
    const text = document.createElement("pre");
    text.className = "preview-text";
    text.textContent = preview;
    content.append(contentHeading, text);
    els.detailCard.appendChild(content);
  }

  const note = document.createElement("label");
  note.className = "help-text";
  note.textContent = "Optional note";
  note.setAttribute("for", "review-note");

  const noteField = document.createElement("textarea");
  noteField.id = "review-note";
  noteField.className = "note-field";
  noteField.placeholder = "Optional note for your gate decision…";

  const actions = document.createElement("div");
  actions.className = "actions";

  const approve = document.createElement("button");
  approve.type = "button";
  approve.className = "btn btn-primary";
  approve.textContent = "Approve";
  approve.addEventListener("click", () => decide("approve", noteField.value, approve, deny));

  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "btn btn-danger";
  deny.textContent = "Deny";
  deny.addEventListener("click", () => decide("deny", noteField.value, approve, deny));

  actions.append(approve, deny);

  const help = document.createElement("p");
  help.className = "help-text";
  help.textContent = "You gate the pipeline. Approve or deny with the buttons. J/K move between items when not typing.";

  els.detailCard.append(note, noteField, actions, help);
}

function appendMetaRow(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = String(value);
  dl.append(dt, dd);
}

function renderError(message) {
  els.detailEmpty.hidden = true;
  els.detailCard.hidden = false;
  els.detailCard.replaceChildren();
  const box = document.createElement("div");
  box.className = "error-state";
  const heading = document.createElement("h2");
  heading.textContent = "Could not load queue";
  const text = document.createElement("p");
  text.textContent = message;
  box.append(heading, text);
  els.detailCard.appendChild(box);
}

function setActionButtonsDisabled(approveBtn, denyBtn, disabled) {
  if (approveBtn) approveBtn.disabled = disabled;
  if (denyBtn) denyBtn.disabled = disabled;
}

async function decide(action, note, approveBtn, denyBtn) {
  if (!state.selectedId || state.deciding) return;

  if (action === "deny") {
    const ok = window.confirm("Deny this proposal and remove it from the open queue?");
    if (!ok) return;
  }

  state.deciding = true;
  setActionButtonsDisabled(approveBtn, denyBtn, true);

  const currentIndex = state.filtered.findIndex((item) => item.id === state.selectedId);
  const currentId = state.selectedId;

  try {
    await api(`/api/review/${encodeURIComponent(currentId)}`, {
      method: "POST",
      body: JSON.stringify({ action, note: note.trim() }),
    });

    state.items = state.items.filter((item) => item.id !== currentId);
    state.queueTotal = Math.max(0, state.queueTotal - 1);
    els.queueCount.textContent = String(state.queueTotal);
    applyFilter();

    const next = state.filtered[currentIndex] || state.filtered[currentIndex - 1] || null;
    state.selectedId = next?.id || null;

    showToast(action === "approve" ? "Approved." : "Denied.");

    if (next) {
      selectItem(next.id);
    } else {
      renderDetail(null);
      els.detailEmpty.hidden = false;
      els.detailCard.hidden = true;
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.deciding = false;
    setActionButtonsDisabled(approveBtn, denyBtn, false);
  }
}

function onKeyDown(event) {
  if (isEditableTarget(event.target)) return;
  if (state.deciding) return;

  const index = state.filtered.findIndex((item) => item.id === state.selectedId);
  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    const next = state.filtered[index + 1];
    if (next) selectItem(next.id);
  }
  if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    const prev = state.filtered[index - 1];
    if (prev) selectItem(prev.id);
  }
}

function updatePositionLabel() {
  const index = state.filtered.findIndex((item) => item.id === state.selectedId);
  if (index === -1 || !state.filtered.length) {
    els.positionLabel.hidden = true;
    return;
  }
  els.positionLabel.hidden = false;
  els.positionLabel.textContent = `${index + 1} of ${state.filtered.length}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, 2200);
}

function labelForKind(kind) {
  const labels = {
    github: "GitHub",
    huggingface: "HF",
    arxiv: "ArXiv",
    article: "Article",
    "design-tool": "Design",
    url: "URL",
  };
  return labels[kind] || "URL";
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("github.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    }
    return parsed.hostname;
  } catch {
    return url;
  }
}

function formatWhen(value) {
  if (!value) return "unknown";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
