const HINT =
  "Use Browse for the system folder dialog (server reads the path). Or paste a path from Explorer.";

const MERMAID_PLACEHOLDER =
  "No graph file yet. Sequential mode writes debate_graph.mermaid after each turn finishes.";

let currentRunId = null;
let streamLineAfter = 0;
let snapshotTimer = null;
let streamTimer = null;
/**
 * Real-time Mermaid: `GET /api/runs/<id>/mermaid` returns `{ mermaid, rev }` (32k cap, safe run dir).
 * Poll ~300ms while a run is active; `rev` (mtime_ns + size) dedupes updates vs `lastMermaidKey`.
 * Raw Mermaid file text is in `#mermaidPre` (modal); live graph uses vis-network from snapshot.
 * On disk, `debate_graph.mermaid` updates after each sequential turn completes, not mid-turn.
 */
let mermaidTimer = null;
/** Dedupe poll updates: server `rev`, or "__empty__", or blob length fallback. */
let lastMermaidKey = null;

/** Full plan from guided layer; attached to POST /api/runs as `guided` when starting. */
let lastGuidedPlan = null;
/** After a successful planner response, equals `target\\nquery` so we skip replanning. */
let lastPlanOkKey = null;

let inspectTimer = null;

/** Set `targetPath` once when opening a run from the roll (from meta.target). */
let appliedMetaTargetForRun = null;

/** Live debate web (vis-network); rebuilt/updated from snapshot debate_track + agents. */
let debateNetwork = null;
let debateNodes = null;
let debateEdges = null;
let lastNetSig = "";

let hallOverlayDepth = 0;

function destroyDebateWeb() {
  lastNetSig = "";
  if (debateNetwork) {
    try {
      debateNetwork.destroy();
    } catch (_) {
      /* ignore */
    }
    debateNetwork = null;
    debateNodes = null;
    debateEdges = null;
  }
  const el = document.getElementById("debateNet");
  if (el) el.replaceChildren();
}

function updateStreamSummary() {
  const pre = document.getElementById("streamPre");
  const sum = document.getElementById("streamSummary");
  if (!pre || !sum) return;
  const t = pre.textContent || "";
  const lines = t ? t.split("\n").length : 0;
  const tail = t.trimEnd().split("\n").pop() || "";
  const short = tail.length > 72 ? `${tail.slice(0, 69)}…` : tail;
  sum.textContent = short ? `${lines} lines · ${short}` : `${lines} lines`;
}

function updateHallNowBar(snap) {
  const bar = document.getElementById("hallNowBar");
  const txt = document.getElementById("hallNowText");
  if (!bar || !txt) return;
  const meta = snap.meta || {};
  const archive = String(meta.status || "").trim().toLowerCase();
  const terminal = new Set([
    "complete",
    "completed",
    "failed",
    "error",
    "cancelled",
  ]);
  if (!currentRunId || terminal.has(archive)) {
    bar.hidden = true;
    txt.textContent = "—";
    bar.classList.remove("hall-now-bar--hot");
    return;
  }

  const track = snap.debate_track || [];
  const agents = (snap.status && snap.status.agents) || [];
  const phase = String((snap.status && snap.status.phase) || "")
    .replace(/_/g, " ")
    .trim();

  let line = "";
  for (let i = track.length - 1; i >= 0; i--) {
    const st = String(track[i].state || "").toLowerCase();
    if (st === "live" || st === "running") {
      line = [
        track[i].finding_id != null && `F${track[i].finding_id}`,
        track[i].role,
        track[i].agent_name,
      ]
        .filter(Boolean)
        .join(" · ");
      break;
    }
  }
  if (!line) {
    const run = agents.find(
      (a) => String(a.status || "").toLowerCase() === "running",
    );
    if (run)
      line = `${(run.name || "Speaker").split(/\s+/)[0]} · on the floor`;
  }
  if (!line && track.length) {
    const last = track[track.length - 1];
    line = [
      last.finding_id != null && `F${last.finding_id}`,
      last.role,
      last.agent_name,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (!line && phase) line = phase;
  if (!line) line = "Assembly in session";

  txt.textContent = line;
  bar.hidden = false;
  const hot =
    track.some((s) => {
      const st = String(s.state || "").toLowerCase();
      return st === "live" || st === "running";
    }) ||
    agents.some((a) => String(a.status || "").toLowerCase() === "running");
  bar.classList.toggle("hall-now-bar--hot", hot);
}

function updateDebateWebFromSnap(snap) {
  const container = document.getElementById("debateNet");
  const wrap = document.getElementById("mermaidWrap");
  if (!container || !wrap || wrap.hidden || !currentRunId) return;

  const visRef = globalThis.vis;
  if (!visRef?.DataSet || !visRef?.Network) {
    container.textContent = "";
    const p = document.createElement("p");
    p.className = "mermaid-error";
    p.textContent = "Network graph library did not load (check CDN / offline).";
    container.appendChild(p);
    return;
  }

  const steps = snap.debate_track || [];
  const st = snap.status || {};
  const agents = Array.isArray(st.agents) ? st.agents : [];
  const phase = String(st.phase || "assembly");

  const sig = JSON.stringify({
    phase,
    steps: steps.map((s, i) => [
      i,
      s.state,
      s.finding_id,
      s.role,
      s.slot,
      s.agent_name,
    ]),
    ag: agents.map((a) => [a.slot, a.status, a.name]),
  });
  if (sig === lastNetSig) return;
  lastNetSig = sig;

  const nodes = [];
  const edges = [];
  const accent = "#d4a84b";
  const dim = "#5c6478";
  const liveB = "#4a3d18";
  const liveBorder = "#d4a84b";
  const doneB = "#1a3328";
  const doneBorder = "#6bcf9b";
  const idleB = "#1c222c";
  const idleBorder = "#4a5568";

  nodes.push({
    id: "phase",
    label: phase.replace(/_/g, " "),
    shape: "box",
    margin: 12,
    color: { background: "#252a35", border: accent },
    font: { color: "#e8ecf5", size: 13 },
  });

  const seenAg = new Set();
  for (const a of agents) {
    if (typeof a.slot !== "number" || a.slot < 0) continue;
    const id = `ag${a.slot}`;
    if (seenAg.has(id)) continue;
    seenAg.add(id);
    const nm = (a.name || `Speaker ${a.slot + 1}`).split(/\s+/)[0];
    const running = String(a.status || "").toLowerCase() === "running";
    nodes.push({
      id,
      label: running ? `${nm}\n●` : nm,
      shape: "dot",
      size: running ? 24 : 16,
      color: {
        background: running ? liveB : "#2a2632",
        border: running ? liveBorder : dim,
      },
      font: { color: "#e8ecf5", size: 11 },
    });
    edges.push({
      from: "phase",
      to: id,
      color: { color: "#5a6678", opacity: 0.65 },
      dashes: [2, 4],
    });
  }

  let prev = "phase";
  steps.forEach((s, i) => {
    const id = `st${i}`;
    const stt = String(s.state || "").toLowerCase();
    let bg = idleB;
    let br = idleBorder;
    if (stt === "live" || stt === "running") {
      bg = liveB;
      br = liveBorder;
    } else if (stt === "done" || stt === "completed") {
      bg = doneB;
      br = doneBorder;
    }
    const lbl =
      [
        s.finding_id != null ? `F${s.finding_id}` : "",
        s.role || "",
        s.agent_name ? String(s.agent_name).split(/\s+/)[0] : "",
      ]
        .filter(Boolean)
        .join("\n") || `Turn ${i + 1}`;
    nodes.push({
      id,
      label: lbl,
      shape: "dot",
      size: 18,
      color: { background: bg, border: br },
      font: { color: "#e8ecf5", size: 11 },
    });
    edges.push({
      from: prev,
      to: id,
      arrows: "to",
      color: { color: "#6b7288" },
      smooth: { type: "curvedCW", roundness: 0.18 },
    });
    prev = id;
    if (typeof s.slot === "number") {
      const aid = `ag${s.slot}`;
      if (seenAg.has(aid)) {
        edges.push({
          from: aid,
          to: id,
          dashes: true,
          color: { color: "#8b7355" },
        });
      }
    }
  });

  /** Keep physics on so the net keeps drifting like a live system (tuned for low churn). */
  const physicsAlwaysOn = {
    enabled: true,
    stabilization: { iterations: 120, updateInterval: 10 },
    solver: "forceAtlas2Based",
    forceAtlas2Based: {
      gravitationalConstant: -42,
      centralGravity: 0.012,
      springLength: 108,
      springConstant: 0.042,
      damping: 0.55,
      avoidOverlap: 0.72,
    },
    maxVelocity: 28,
    minVelocity: 0.35,
    timestep: 0.4,
  };

  const opts = {
    nodes: { borderWidth: 2, shadow: true },
    edges: { width: 1 },
    physics: physicsAlwaysOn,
    interaction: { hover: true, zoomView: true, dragView: true },
  };

  if (!debateNetwork) {
    container.replaceChildren();
    debateNodes = new visRef.DataSet(nodes);
    debateEdges = new visRef.DataSet(edges);
    debateNetwork = new visRef.Network(
      container,
      { nodes: debateNodes, edges: debateEdges },
      opts,
    );
    debateNetwork.once("stabilizationIterationsDone", () => {
      debateNetwork.fit({
        animation: { duration: 380, easingFunction: "easeInOutQuad" },
      });
    });
  } else {
    debateNodes.clear();
    debateEdges.clear();
    debateNodes.add(nodes);
    debateEdges.add(edges);
    debateNetwork.setOptions({ physics: { ...physicsAlwaysOn } });
  }
}

function openHallModalPre(title, text) {
  const m = document.getElementById("hallModal");
  const body = document.getElementById("hallModalBody");
  const tEl = document.getElementById("hallModalTitle");
  if (!m || !body || !tEl) return;
  tEl.textContent = title;
  body.replaceChildren();
  const pre = document.createElement("pre");
  pre.className = "hall-modal-pre";
  pre.textContent = text || "(empty)";
  body.appendChild(pre);
  m.hidden = false;
  document.body.classList.add("hall-modal-open");
  document.getElementById("hallModalClose")?.focus();
}

function closeHallModal() {
  const m = document.getElementById("hallModal");
  if (!m) return;
  m.hidden = true;
  document.body.classList.remove("hall-modal-open");
  document.getElementById("hallModalBody")?.replaceChildren();
}

function syncPlanDetailsButton() {
  const btn = document.getElementById("btnOpenPlanDetails");
  if (!btn) return;
  const reph = document.getElementById("planRephrase")?.textContent.trim() ?? "";
  const rat = document.getElementById("planRationale")?.textContent.trim() ?? "";
  const n = document.querySelectorAll("#planFocusList li").length;
  btn.hidden = !(reph || rat || n);
}

function pushHallOverlay(message) {
  hallOverlayDepth += 1;
  const t = document.getElementById("hallLoadText");
  const o = document.getElementById("hallLoadOverlay");
  if (t) t.textContent = message;
  if (o) o.hidden = false;
  document.body.classList.add("hall-app--ui-blocked");
}

function popHallOverlay() {
  hallOverlayDepth = Math.max(0, hallOverlayDepth - 1);
  if (hallOverlayDepth > 0) return;
  const o = document.getElementById("hallLoadOverlay");
  if (o) o.hidden = true;
  document.body.classList.remove("hall-app--ui-blocked");
}

function setRollSyncing(on) {
  document.body.classList.toggle("hall-app--syncing-roll", on);
  const ind = document.getElementById("rollSyncIndicator");
  if (ind) ind.hidden = !on;
  const sel = document.getElementById("runPick");
  if (sel) sel.disabled = on;
}

function setButtonLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle("btn--loading", on);
  btn.setAttribute("aria-busy", on ? "true" : "false");
}

function flashButtonComplete(btn) {
  if (!btn) return;
  btn.classList.add("btn--done");
  setTimeout(() => btn.classList.remove("btn--done"), 1400);
}

function flashPollTick() {
  const tick = document.getElementById("pollTick");
  if (!tick) return;
  tick.classList.remove("clerk-tick--pulse");
  void tick.offsetWidth;
  tick.classList.add("clerk-tick--pulse");
  setTimeout(() => tick.classList.remove("clerk-tick--pulse"), 650);
}

function setStartFormBusy(busy) {
  const form = document.getElementById("startForm");
  const bar = document.getElementById("planLoaderBar");
  const btn = document.getElementById("btnStartRun");
  if (form) form.classList.toggle("hall-form--busy", busy);
  if (bar) {
    bar.hidden = !busy;
    bar.setAttribute("aria-hidden", busy ? "false" : "true");
  }
  if (btn) setButtonLoading(btn, busy);
}

function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const m = h.match(/^run\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].trim());
  } catch {
    return m[1].trim();
  }
}

/** Stable hash link for a run (always `#/run/<id>`). */
function setRunHash(runId) {
  location.hash = "#/run/" + encodeURIComponent(runId);
}

function clearRunHash() {
  const base = `${location.pathname}${location.search}`;
  history.replaceState(null, "", base);
}

async function fetchRuns() {
  const r = await fetch("/api/runs");
  const j = await r.json();
  return j.runs || [];
}

async function fetchSnapshot(runId) {
  const r = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function fetchStream(runId) {
  const r = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/stream?after=${streamLineAfter}`,
  );
  if (!r.ok) return null;
  return r.json();
}

function mermaidPollKey(data) {
  if (data.rev != null) return String(data.rev);
  if (data.mermaid) return `blob-${data.mermaid.length}`;
  return "__empty__";
}

async function fetchMermaid(runId) {
  const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/mermaid`);
  if (!r.ok) return null;
  return r.json();
}

function prepareMermaidPanelForRun() {
  const wrap = document.getElementById("mermaidWrap");
  const mp = document.getElementById("mermaidPre");
  wrap.hidden = false;
  mp.textContent = MERMAID_PLACEHOLDER;
  lastMermaidKey = null;
  destroyDebateWeb();
}

async function pollMermaid() {
  if (!currentRunId) return;
  const data = await fetchMermaid(currentRunId);
  if (!data) return;
  const key = mermaidPollKey(data);
  if (key === lastMermaidKey) return;
  lastMermaidKey = key;

  const mp = document.getElementById("mermaidPre");
  if (data.mermaid) {
    mp.textContent = data.mermaid;
  } else {
    mp.textContent = MERMAID_PLACEHOLDER;
  }
}

function setPathHint(text) {
  document.getElementById("pathHint").textContent = text;
}

/** Assemble every visible plan field (+ full guided JSON when present) for clipboard. */
function buildFullPlanTextForCopy() {
  const motion = document.getElementById("planQuery").value.trim();
  const status = document.getElementById("planStatus").textContent.trim();
  const reph = document.getElementById("planRephrase").textContent.trim();
  const rat = document.getElementById("planRationale").textContent.trim();
  const items = [
    ...document.querySelectorAll("#planFocusList li"),
  ].map((li) => li.textContent.trim()).filter(Boolean);
  const blocks = [];
  if (motion) blocks.push(`Motion\n${motion}`);
  if (status) blocks.push(`Status\n${status}`);
  if (reph) blocks.push(reph);
  if (items.length)
    blocks.push(`Focus points\n${items.map((t) => `• ${t}`).join("\n")}`);
  if (rat) blocks.push(`Rationale\n${rat}`);
  if (lastGuidedPlan)
    blocks.push(
      `Guided plan (full JSON)\n${JSON.stringify(lastGuidedPlan, null, 2)}`,
    );
  return (
    blocks.join("\n\n") ||
    "(No plan text yet — add a motion, run the planners by convening, or paste from elsewhere.)"
  );
}

let planCopyRestoreTimer = null;

async function copyFullPlanToClipboard(triggerBtn) {
  const btn = triggerBtn || document.getElementById("btnCopyPlanFull");
  const text = buildFullPlanTextForCopy();
  const st = document.getElementById("planStatus");
  if (planCopyRestoreTimer) {
    clearTimeout(planCopyRestoreTimer);
    planCopyRestoreTimer = null;
  }
  const prev = st.textContent;
  const restore = () => {
    planCopyRestoreTimer = null;
    st.textContent = prev;
  };
  btn?.classList.add("btn-icon-copy--loading");
  try {
    await navigator.clipboard.writeText(text);
    st.textContent = "Full plan copied to clipboard.";
    planCopyRestoreTimer = setTimeout(restore, 2200);
    flashButtonComplete(btn);
  } catch {
    st.textContent = "Copy failed — select plan text manually.";
    planCopyRestoreTimer = setTimeout(restore, 2200);
  } finally {
    btn?.classList.remove("btn-icon-copy--loading");
  }
}

function applyPlanToForm(plan) {
  if (!plan) return;
  document.getElementById("timeoutSec").value = String(plan.timeout ?? 300);
  document.getElementById("debateMode").value =
    plan.debate_mode === "legacy" ? "legacy" : "sequential";
  const mf = plan.max_findings_debate;
  document.getElementById("maxFindings").value =
    mf != null && mf !== "" ? String(mf) : "";
  document.getElementById("optImprovementPlan").checked = !!plan.improvement_plan;
  document.getElementById("optGitWorktrees").checked = !!plan.use_git_worktrees;

  const list = document.getElementById("planFocusList");
  list.innerHTML = "";
  for (const t of plan.focus_points || []) {
    const li = document.createElement("li");
    li.textContent = t;
    list.appendChild(li);
  }
  const reph = document.getElementById("planRephrase");
  reph.textContent = plan.query_rephrase
    ? `Intent: ${plan.query_rephrase}`
    : "";
  const rat = document.getElementById("planRationale");
  rat.textContent = plan.internal_rationale || "";

  lastGuidedPlan = plan;
  const st = document.getElementById("planStatus");
  st.textContent =
    "Plan applied — adjust standing rules if needed, then Convene assembly (or convene again to refresh the plan).";
  const target = document.getElementById("targetPath").value.trim();
  const query = document.getElementById("planQuery").value.trim();
  lastPlanOkKey = `${target}\n${query}`;
  syncPlanDetailsButton();
}

/**
 * Run guided planner; throws on failure. Caller ensures query and target are set.
 */
async function runGuidedPlannerPoll() {
  const query = document.getElementById("planQuery").value.trim();
  const target = document.getElementById("targetPath").value.trim();
  const st = document.getElementById("planStatus");
  st.textContent =
    "Planning… (Cursor agents: focus analyst → run strategist on this machine)";
  const r = await fetch("/api/plan-run/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, target, timeout_per_agent: 180 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "start failed");
  const token = j.token;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const rr = await fetch(
      `/api/plan-run/result?token=${encodeURIComponent(token)}`,
    );
    const jj = await rr.json();
    if (jj.pending) {
      await new Promise((x) => setTimeout(x, 600));
      continue;
    }
    if (jj.error) throw new Error(jj.error);
    if (!jj.plan) throw new Error("No plan returned");
    applyPlanToForm(jj.plan);
    return;
  }
  throw new Error("Plan timed out");
}

function scheduleTargetInspect() {
  if (inspectTimer) clearTimeout(inspectTimer);
  inspectTimer = setTimeout(async () => {
    inspectTimer = null;
    const p = document.getElementById("targetPath").value.trim();
    const badge = document.getElementById("gitTargetBadge");
    const wt = document.getElementById("optGitWorktrees");
    if (!p) {
      badge.textContent = "";
      badge.classList.remove("git-badge--loading");
      wt.checked = false;
      wt.disabled = true;
      return;
    }
    badge.classList.add("git-badge--loading");
    badge.textContent = "Inspecting repository…";
    try {
      const r = await fetch(
        `/api/target-inspect?path=${encodeURIComponent(p)}`,
      );
      const j = await r.json();
      badge.classList.remove("git-badge--loading");
      if (!j.exists) {
        badge.textContent = j.error
          ? String(j.error)
          : "Path is not a directory.";
        wt.checked = false;
        wt.disabled = true;
        return;
      }
      if (j.is_git) {
        const bits = [];
        if (j.branch) bits.push(j.branch);
        if (j.head_short) bits.push(j.head_short);
        badge.textContent = `Git · ${bits.join(" · ") || "repo"} — detached worktrees enabled for agents 2+`;
        wt.disabled = false;
        wt.checked = true;
      } else {
        badge.textContent =
          "Not a git repo — all agents share one tree (worktrees N/A).";
        wt.checked = false;
        wt.disabled = true;
      }
    } catch {
      badge.classList.remove("git-badge--loading");
      badge.textContent = "";
    }
  }, 450);
}

function renderTrack(snap) {
  const el = document.getElementById("track");
  const steps = snap.debate_track || [];
  if (!steps.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = steps
    .map((s) => {
      const st = (s.state || "").toLowerCase();
      let cls = "step";
      if (st === "live" || st === "running") cls += " active";
      else if (st === "done" || st === "completed") cls += " done";
      const label = [s.finding_id, s.role, s.agent_name].filter(Boolean).join(" · ");
      return `<div class="${cls}">${escapeHtml(label || JSON.stringify(s))}</div>`;
    })
    .join("");
}

/** Map first three agent slots to placard status lines. */
function mergeAgents(snap) {
  const st = snap.status || {};
  const agents = Array.isArray(st.agents) ? st.agents : [];
  const bySlot = new Map();
  for (const a of agents) {
    const sl = a.slot;
    if (typeof sl !== "number" || sl < 0 || sl > 2) continue;
    bySlot.set(sl, a);
  }
  for (let s = 0; s < 3; s++) {
    const el = document.querySelector(`.debater-slot[data-slot="${s}"]`);
    if (!el) continue;
    const stateEl = el.querySelector(".debater-state");
    if (!stateEl) continue;
    const ag = bySlot.get(s);
    if (!ag) {
      stateEl.textContent = "Idle";
      continue;
    }
    const raw = (ag.status || "").toLowerCase();
    const short =
      raw === "running"
        ? "Speaking…"
        : raw === "completed"
          ? "Done"
          : raw === "failed" || raw === "error"
            ? "Failed"
            : raw || "—";
    const firstName = (ag.name || "").split(/\s+/)[0] || "Agent";
    stateEl.textContent = `${firstName} · ${short}`;
  }
}

/** Highlight podium sprite by live debate step or running agent. */
function setDebaterMoods(snap) {
  const track = snap.debate_track || [];
  const st = snap.status || {};
  const agents = Array.isArray(st.agents) ? st.agents : [];
  let speakingSlot = null;
  for (let i = track.length - 1; i >= 0; i--) {
    const step = track[i];
    const state = (step.state || "").toLowerCase();
    if (state === "live" || state === "running") {
      const sl = step.slot;
      speakingSlot = typeof sl === "number" ? Math.min(sl, 2) : null;
      break;
    }
  }
  if (speakingSlot == null) {
    const running = agents.find(
      (a) =>
        String(a.status || "").toLowerCase() === "running" &&
        typeof a.slot === "number" &&
        a.slot >= 0 &&
        a.slot <= 2,
    );
    if (running) speakingSlot = running.slot;
  }
  const bad = new Set(
    agents
      .filter((a) => {
        const x = String(a.status || "").toLowerCase();
        return x === "failed" || x === "error" || x === "timeout";
      })
      .map((a) => a.slot)
      .filter((s) => typeof s === "number" && s >= 0 && s <= 2),
  );
  for (let s = 0; s < 3; s++) {
    const el = document.querySelector(`.debater-slot[data-slot="${s}"]`);
    if (!el) continue;
    let mood = "idle";
    if (speakingSlot === s) mood = "speaking";
    else if (bad.has(s)) mood = "stricken";
    el.setAttribute("data-mood", mood);
  }
}

function setHallLive(on) {
  document.body.classList.toggle("hall-app--live", on);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applySnapshot(snap) {
  const st = snap.status || {};
  const meta = snap.meta || {};
  if (
    currentRunId &&
    meta.target &&
    appliedMetaTargetForRun !== currentRunId
  ) {
    const t = String(meta.target).trim();
    if (t) {
      document.getElementById("targetPath").value = t;
      scheduleTargetInspect();
      appliedMetaTargetForRun = currentRunId;
    }
  }
  const titleEl = document.getElementById("sessionTitle");
  const label = meta.label || meta.run_id || "Session";
  titleEl.textContent = label;

  const parts = [
    st.phase && `Phase: ${st.phase}`,
    st.score != null && `Score: ${st.score}`,
    meta.status && `Archive: ${meta.status}`,
  ].filter(Boolean);
  document.getElementById("statusLine").textContent =
    parts.join(" · ") || "The floor is open — testimony arriving…";

  renderTrack(snap);
  mergeAgents(snap);
  setDebaterMoods(snap);
  updateHallNowBar(snap);
  updateDebateWebFromSnap(snap);

  const mer = snap.debate_graph_mermaid;
  const mp = document.getElementById("mermaidPre");
  const wrap = document.getElementById("mermaidWrap");
  if (currentRunId) wrap.hidden = false;
  if (mer) {
    mp.textContent = mer;
    lastMermaidKey = null;
  }

  const ipWrap = document.getElementById("improvementPlanWrap");
  const ipPre = document.getElementById("improvementPlanPre");
  const ipp = snap.improvement_plan_preview;
  if (ipp && String(ipp).trim() && currentRunId) {
    ipWrap.hidden = false;
    ipPre.textContent = ipp;
  } else {
    ipWrap.hidden = true;
    ipPre.textContent = "";
  }

  updateStreamSummary();
}

async function pollStream() {
  if (!currentRunId) return;
  const data = await fetchStream(currentRunId);
  if (!data || !data.events?.length) {
    if (data && typeof data.next === "number") streamLineAfter = data.next;
    return;
  }
  const pre = document.getElementById("streamPre");
  for (const ev of data.events) {
    const line =
      (ev.chunk != null ? String(ev.chunk) : JSON.stringify(ev)) + "\n";
    pre.textContent += line;
  }
  pre.scrollTop = pre.scrollHeight;
  streamLineAfter = data.next;
  updateStreamSummary();
}

async function pollSnapshot() {
  if (!currentRunId) return;
  try {
    const snap = await fetchSnapshot(currentRunId);
    applySnapshot(snap);
    const tick = document.getElementById("pollTick");
    if (tick)
      tick.textContent = `Clerk · ${new Date().toLocaleTimeString()}`;
  } catch {
    document.getElementById("statusLine").textContent =
      "Clerk could not read the docket for this assembly.";
  }
}

async function refreshRunSelect() {
  let list;
  try {
    list = await fetchRuns();
  } catch {
    return;
  }
  const sel = document.getElementById("runPick");
  const preferred = currentRunId || sel.value;
  sel.innerHTML = '<option value="">— New assembly —</option>';
  for (const x of list) {
    const id = x.run_id || x.label;
    if (!id) continue;
    const opt = document.createElement("option");
    opt.value = id;
    const st = x.status || "?";
    const short = id.length > 12 ? `${id.slice(0, 8)}…` : id;
    const lbl = x.label && String(x.label) !== id ? x.label : short;
    opt.textContent = `${lbl} · ${st}`;
    sel.appendChild(opt);
  }
  if (preferred && [...sel.options].some((o) => o.value === preferred)) {
    sel.value = preferred;
  }
}

function resetStageIdle() {
  document.getElementById("sessionTitle").textContent = "Hall in recess";
  document.getElementById("statusLine").textContent =
    "Choose a prior assembly from the clerk’s roll, or call a new one from the sidebar.";
  document.getElementById("track").innerHTML = "";
  document.getElementById("streamPre").textContent = "";
  updateStreamSummary();
  const nowBar = document.getElementById("hallNowBar");
  if (nowBar) {
    nowBar.hidden = true;
    nowBar.classList.remove("hall-now-bar--hot");
  }
  const wrap = document.getElementById("mermaidWrap");
  const mp = document.getElementById("mermaidPre");
  wrap.hidden = true;
  mp.textContent = "";
  lastMermaidKey = null;
  destroyDebateWeb();
  const ipWrap = document.getElementById("improvementPlanWrap");
  const ipPre = document.getElementById("improvementPlanPre");
  if (ipWrap) ipWrap.hidden = true;
  if (ipPre) ipPre.textContent = "";
  for (let s = 0; s < 3; s++) {
    const el = document.querySelector(`.debater-slot[data-slot="${s}"]`);
    if (!el) continue;
    el.setAttribute("data-mood", "idle");
    const stateEl = el.querySelector(".debater-state");
    if (stateEl) stateEl.textContent = "—";
  }
  const tick = document.getElementById("pollTick");
  if (tick) tick.textContent = "";
}

async function onRoute() {
  const id = parseHash();
  currentRunId = id;
  const openingAssembly = Boolean(id);
  if (openingAssembly) pushHallOverlay("Opening assembly…");
  else setRollSyncing(true);
  try {
    await refreshRunSelect();
    if (!id) {
      appliedMetaTargetForRun = null;
      setHallLive(false);
      stopTimers();
      resetStageIdle();
      return;
    }
    const sel = document.getElementById("runPick");
    if (![...sel.options].some((o) => o.value === id)) {
      document.getElementById("statusLine").textContent =
        "That assembly id is not on the clerk’s roll (moved or removed).";
      clearRunHash();
      currentRunId = null;
      appliedMetaTargetForRun = null;
      sel.value = "";
      setHallLive(false);
      stopTimers();
      resetStageIdle();
      await refreshRunSelect();
      return;
    }
    sel.value = id;
    setHallLive(true);
    document.getElementById("streamPre").textContent = "";
    streamLineAfter = 0;
    stopTimers();
    prepareMermaidPanelForRun();
    await pollSnapshot();
    await pollStream();
    await pollMermaid();
    flashPollTick();
    snapshotTimer = setInterval(pollSnapshot, 1100);
    streamTimer = setInterval(pollStream, 450);
    mermaidTimer = setInterval(pollMermaid, 300);
  } finally {
    if (openingAssembly) popHallOverlay();
    else setRollSyncing(false);
  }
}

function stopTimers() {
  if (snapshotTimer) clearInterval(snapshotTimer);
  if (streamTimer) clearInterval(streamTimer);
  if (mermaidTimer) clearInterval(mermaidTimer);
  snapshotTimer = null;
  streamTimer = null;
  mermaidTimer = null;
}

const PICK_MAX_MS = 180_000;

let pickFolderCancelHandler = null;

async function cancelPickFolderRequest(token) {
  if (!token) return;
  try {
    await fetch("/api/pick-folder/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch (_) {
    /* ignore */
  }
}

async function nativePickFolder() {
  const btn = document.getElementById("btnPickFolder");
  const btnCancel = document.getElementById("btnCancelPick");
  btn.disabled = true;
  setButtonLoading(btn, true);
  btnCancel.hidden = false;
  btnCancel.disabled = false;
  setPathHint("Choose a folder in the system dialog…");
  let token = null;
  let aborted = false;
  pickFolderCancelHandler = () => {
    aborted = true;
    cancelPickFolderRequest(token);
  };
  btnCancel.addEventListener("click", pickFolderCancelHandler);
  try {
    const r = await fetch("/api/pick-folder/start", { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "start failed");
    token = j.token;
    const deadline = Date.now() + PICK_MAX_MS;
    while (Date.now() < deadline) {
      if (aborted) break;
      const rr = await fetch(
        `/api/pick-folder/result?token=${encodeURIComponent(token)}`,
      );
      const jj = await rr.json();
      if (jj.pending) {
        await new Promise((r2) => setTimeout(r2, 400));
        continue;
      }
      if (jj.error) {
        alert(jj.error);
        return;
      }
      if (jj.cancelled || !jj.path) {
        if (aborted) setPathHint("Folder browse cancelled.");
        return;
      }
      document.getElementById("targetPath").value = jj.path;
      setPathHint("Path set.");
      lastGuidedPlan = null;
      lastPlanOkKey = null;
      scheduleTargetInspect();
      return;
    }
    if (aborted) {
      setPathHint("Folder browse cancelled.");
    } else {
      await cancelPickFolderRequest(token);
      setPathHint("Picker timed out — paste a path or try Browse again.");
    }
  } catch (e) {
    alert(String(e.message || e));
  } finally {
    if (pickFolderCancelHandler) {
      btnCancel.removeEventListener("click", pickFolderCancelHandler);
      pickFolderCancelHandler = null;
    }
    btn.disabled = false;
    setButtonLoading(btn, false);
    btnCancel.hidden = true;
    btnCancel.disabled = true;
    if (!document.getElementById("targetPath").value.trim()) setPathHint(HINT);
  }
}

function parentDir(fullPath) {
  const s = String(fullPath);
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : s;
}

function trySetPathFromFile(file) {
  const p = file?.path;
  if (p && typeof p === "string") {
    document.getElementById("targetPath").value = parentDir(p);
    return true;
  }
  return false;
}

document.getElementById("targetPath").addEventListener("input", () => {
  lastGuidedPlan = null;
  lastPlanOkKey = null;
  scheduleTargetInspect();
});
document.getElementById("planQuery").addEventListener("input", () => {
  lastGuidedPlan = null;
  lastPlanOkKey = null;
});
document.getElementById("btnPickFolder").addEventListener("click", nativePickFolder);
document.getElementById("btnCopyPlanFull").addEventListener("click", (e) => {
  const b = e.currentTarget;
  void copyFullPlanToClipboard(b);
});
document.getElementById("dirInput").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (f && trySetPathFromFile(f)) {
    setPathHint("Path set from host file object.");
    lastGuidedPlan = null;
    lastPlanOkKey = null;
    scheduleTargetInspect();
  } else if (f?.webkitRelativePath) {
    const top = f.webkitRelativePath.split("/")[0];
    setPathHint(`Folder name “${top}” — paste full path or use Folder…`);
  }
  e.target.value = "";
});

document.getElementById("runPick").addEventListener("change", () => {
  const v = document.getElementById("runPick").value;
  if (v) {
    if (parseHash() !== v) setRunHash(v);
  } else if (parseHash()) {
    clearRunHash();
    void onRoute();
  }
});

document.getElementById("btnClearRoll").addEventListener("click", async () => {
  if (
    !confirm(
      "Remove every assembly from the clerk’s roll on this computer? Folders under debate_hall_data/runs/ will be deleted. This cannot be undone.",
    )
  ) {
    return;
  }
  const btn = document.getElementById("btnClearRoll");
  pushHallOverlay("Clearing the roll…");
  setButtonLoading(btn, true);
  try {
    const r = await fetch("/api/runs", { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || "Clear roll failed");
      return;
    }
    const n = (j.deleted || []).length;
    const sk = (j.skipped_busy || []).length;
    let msg = `Removed ${n} saved assembly folder(s).`;
    if (sk) msg += ` ${sk} still running — stop the hall job or wait, then clear again.`;
    if (j.errors?.length) msg += ` Some paths could not be deleted (see server log).`;
    alert(msg);
    clearRunHash();
    currentRunId = null;
    appliedMetaTargetForRun = null;
    document.getElementById("runPick").value = "";
    await refreshRunSelect();
    await onRoute();
    flashButtonComplete(btn);
  } catch (e) {
    alert(String(e.message || e));
  } finally {
    setButtonLoading(btn, false);
    popHallOverlay();
  }
});

document.getElementById("startForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const target = document.getElementById("targetPath").value.trim();
  const query = document.getElementById("planQuery").value.trim();
  const st = document.getElementById("planStatus");
  const btn = document.getElementById("btnStartRun");
  if (!target) {
    alert("Set repository path first.");
    return;
  }
  const planKey = `${target}\n${query}`;
  btn.disabled = true;
  setStartFormBusy(true);
  try {
    if (query) {
      if (!lastGuidedPlan || lastPlanOkKey !== planKey) {
        try {
          await runGuidedPlannerPoll();
        } catch (e) {
          st.textContent = "";
          alert(String(e.message || e));
          return;
        }
      }
    } else {
      lastGuidedPlan = null;
      st.textContent = "";
    }

    const agents = 3;
    const timeout = parseInt(document.getElementById("timeoutSec").value, 10) || 300;
    const debate_mode = document.getElementById("debateMode").value;
    const maxRaw = document.getElementById("maxFindings").value.trim();
    const body = {
      target,
      agents,
      timeout,
      debate_mode,
      improvement_plan: document.getElementById("optImprovementPlan").checked,
      use_git_worktrees: document.getElementById("optGitWorktrees").checked,
    };
    if (maxRaw) body.max_findings_debate = parseInt(maxRaw, 10);
    if (lastGuidedPlan) {
      body.guided = {
        user_query: lastGuidedPlan.user_query,
        focus_points: lastGuidedPlan.focus_points,
        query_rephrase: lastGuidedPlan.query_rephrase,
        internal_rationale: lastGuidedPlan.internal_rationale,
        planner_version: lastGuidedPlan.planner_version,
        planner_agents: lastGuidedPlan.planner_agents,
        target_is_git: lastGuidedPlan.target_is_git,
        debate_mode: lastGuidedPlan.debate_mode,
        num_agents: lastGuidedPlan.num_agents,
        timeout: lastGuidedPlan.timeout,
      };
    }
    const r = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || "Failed");
      return;
    }
    setRunHash(j.run_id);
    flashButtonComplete(btn);
  } finally {
    btn.disabled = false;
    setStartFormBusy(false);
  }
});

document.getElementById("btnStopAgents").addEventListener("click", async () => {
  const btn = document.getElementById("btnStopAgents");
  const st = document.getElementById("statusLine");
  setButtonLoading(btn, true);
  try {
    const r = await fetch("/api/hall/stop-agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      st.textContent = j.error || "Stop agents request failed.";
      return;
    }
    st.textContent =
      "Stop agents: signaled cursor-agent and picker subprocesses (hall still running).";
    flashButtonComplete(btn);
  } catch (e) {
    st.textContent = String(e.message || e);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById("btnCopyAll").addEventListener("click", async () => {
  const btn = document.getElementById("btnCopyAll");
  const a = document.getElementById("streamPre").textContent;
  const b = document.getElementById("mermaidPre").textContent;
  const c = document.getElementById("improvementPlanPre").textContent;
  let text = a;
  if (c?.trim()) text += `\n\n--- improvement plan ---\n${c}`;
  if (b?.trim()) text += `\n\n--- mermaid ---\n${b}`;
  setButtonLoading(btn, true);
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("statusLine").textContent =
      "Transcript copied to the clipboard.";
    flashButtonComplete(btn);
  } catch {
    document.getElementById("statusLine").textContent =
      "Copy failed — select the text by hand.";
  } finally {
    setButtonLoading(btn, false);
  }
});

async function copyModernFieldTarget(btn) {
  const id = btn.getAttribute("data-copy-target");
  const el = id && document.getElementById(id);
  if (!el) return;
  const text =
    "value" in el && typeof el.value === "string"
      ? el.value
      : (el.textContent ?? "");
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("modern-field__copy--done");
    setTimeout(() => btn.classList.remove("modern-field__copy--done"), 1600);
  } catch {
    const t = btn.getAttribute("title") || "Copy";
    btn.setAttribute("title", "Copy failed");
    setTimeout(() => btn.setAttribute("title", t), 2000);
  }
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button.modern-field__copy[data-copy-target]");
  if (!btn) return;
  e.preventDefault();
  void copyModernFieldTarget(btn);
});

window.addEventListener("hashchange", onRoute);

document.getElementById("hallModalClose")?.addEventListener("click", closeHallModal);
document
  .querySelector("#hallModal .hall-modal__backdrop")
  ?.addEventListener("click", closeHallModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const m = document.getElementById("hallModal");
    if (m && !m.hidden) closeHallModal();
  }
});

document.getElementById("btnOpenTranscript")?.addEventListener("click", () => {
  openHallModalPre(
    "Floor transcript",
    document.getElementById("streamPre")?.textContent ?? "",
  );
});

document.getElementById("btnOpenImprovement")?.addEventListener("click", () => {
  openHallModalPre(
    "Improvement plan",
    document.getElementById("improvementPlanPre")?.textContent ?? "",
  );
});

document.getElementById("btnOpenMermaidSource")?.addEventListener("click", () => {
  openHallModalPre(
    "Mermaid source (on-disk export)",
    document.getElementById("mermaidPre")?.textContent ?? "",
  );
});

document.getElementById("btnOpenPlanDetails")?.addEventListener("click", () => {
  const reph = document.getElementById("planRephrase")?.textContent.trim() ?? "";
  const rat = document.getElementById("planRationale")?.textContent.trim() ?? "";
  const items = [
    ...document.querySelectorAll("#planFocusList li"),
  ]
    .map((li) => li.textContent.trim())
    .filter(Boolean);
  const parts = [];
  if (reph) parts.push(`${reph}`);
  if (items.length)
    parts.push(`Focus\n${items.map((t) => `• ${t}`).join("\n")}`);
  if (rat) parts.push(`Rationale\n${rat}`);
  openHallModalPre("Planner details", parts.join("\n\n") || "(empty)");
});

setPathHint(HINT);
scheduleTargetInspect();
onRoute();
setInterval(refreshRunSelect, 20000);

/* =========================================
   UI REDO: SLIDE COORDINATION AND LOGIC
   ========================================= */

function updateSlidesVisibility() {
  const s1 = document.getElementById("slide1");
  const s2 = document.getElementById("slide2");
  if (!s1 || !s2) return;
  // If we have an active run or a route specifies a run, show Slide 2
  if (currentRunId || location.hash.includes("run/")) {
    s1.hidden = true;
    s2.hidden = false;
  } else {
    s1.hidden = false;
    s2.hidden = true;
  }
}

// Hook into hash changes
window.addEventListener("hashchange", () => {
  setTimeout(updateSlidesVisibility, 50);
});

// "Choose dir" navigation button on slide 2
document.getElementById("btnChooseDirNav")?.addEventListener("click", () => {
  clearRunHash();
  currentRunId = null;
  updateSlidesVisibility();
});

// "Option" toggle on slide 2 bottom band
document.getElementById("btnOptionToggle")?.addEventListener("click", () => {
  const comp = document.getElementById("optionComposer");
  if (!comp) return;
  comp.hidden = !comp.hidden;
  if (!comp.hidden) {
    document.getElementById("optionInput")?.focus();
  }
});

document.getElementById("btnCancelOption")?.addEventListener("click", () => {
  document.getElementById("optionComposer").hidden = true;
});

document.getElementById("btnSendOption")?.addEventListener("click", async () => {
  const inputEl = document.getElementById("optionInput");
  const val = inputEl?.value.trim();
  if (!val) return;
  
  const btn = document.getElementById("btnSendOption");
  setButtonLoading(btn, true);
  try {
    await fetch(`/api/runs/${encodeURIComponent(currentRunId || "")}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: val })
    }).catch(e => console.warn("Input injection endpoint missing:", e));
    
    inputEl.value = "";
    document.getElementById("optionComposer").hidden = true;
  } finally {
    setButtonLoading(btn, false);
  }
});

// Poll to auto-detect "plan created" for Slide 3 Modal
let lastPlanTextLen = 0;
setInterval(() => {
  updateSlidesVisibility(); // Defensive fallback to keep slides synced
  
  // Custom sync for Latest Chat
  const streamPre = document.getElementById("streamPre");
  const latestChat = document.getElementById("slide2LatestChat");
  if (streamPre && latestChat) {
    const lines = (streamPre.textContent || "").trim().split('\n').filter(Boolean);
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      // Extract useful text
      latestChat.textContent = lastLine.length > 80 ? lastLine.substring(0, 77) + "..." : lastLine;
    }
  }

  // Slide 3 Modal triggering logic
  const planEl = document.getElementById("improvementPlanPre");
  if (planEl) {
    const textLen = (planEl.textContent || "").length;
    if (textLen > 10 && lastPlanTextLen <= 10) {
      // Plan was just created
      const bodyEl = document.getElementById("hallModalBody");
      const phEl = document.getElementById("planCreatedPlaceholder");
      if (bodyEl && phEl) {
        bodyEl.innerHTML = "";
        phEl.hidden = false;
      }
      const modal = document.getElementById("hallModal");
      if (modal) {
        modal.hidden = false;
        document.body.classList.add("hall-modal-open");
      }
    }
    lastPlanTextLen = textLen;
  }
}, 500);
