const HINT =
  "Use “Folder…” for a native picker on this PC (server reads the path). Or paste a path from Explorer.";

const MERMAID_PLACEHOLDER =
  "No graph file yet. Sequential mode writes debate_graph.mermaid after each turn finishes.";

let currentRunId = null;
let streamLineAfter = 0;
let snapshotTimer = null;
let streamTimer = null;
let mermaidTimer = null;
/** Dedupe poll updates: server rev, or "__empty__", or length-based fallback. */
let lastMermaidKey = null;

/** Full plan from guided layer; attached to POST /api/runs as `guided` when starting. */
let lastGuidedPlan = null;
/** After a successful planner response, equals `target\\nquery` so we skip replanning. */
let lastPlanOkKey = null;

let inspectTimer = null;

let mermaidModulePromise = null;
let mermaidRenderSeq = 0;

function parseHash() {
  const h = (location.hash || "").replace(/^#\/?/, "");
  const m = h.match(/^run\/(.+)$/);
  return m ? m[1] : null;
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

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import(
      "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs"
    ).then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
      });
      return m;
    });
  }
  return mermaidModulePromise;
}

async function renderMermaidDiagram(source) {
  const host = document.getElementById("mermaidDiagram");
  if (!host) return;
  if (!source?.trim()) {
    host.innerHTML = "";
    return;
  }
  const my = ++mermaidRenderSeq;
  try {
    const mermaid = await loadMermaid();
    if (my !== mermaidRenderSeq) return;
    const graphId = `hallMg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { svg } = await mermaid.render(graphId, source);
    if (my !== mermaidRenderSeq) return;
    host.innerHTML = svg;
  } catch (e) {
    if (my !== mermaidRenderSeq) return;
    host.innerHTML = `<p class="mermaid-error">${escapeHtml(String(e.message || e))}</p>`;
  }
}

function prepareMermaidPanelForRun() {
  const wrap = document.getElementById("mermaidWrap");
  const mp = document.getElementById("mermaidPre");
  const bm = document.getElementById("btnCopyMermaid");
  wrap.hidden = false;
  mp.textContent = MERMAID_PLACEHOLDER;
  bm.hidden = true;
  lastMermaidKey = null;
  const host = document.getElementById("mermaidDiagram");
  if (host) host.innerHTML = "";
}

async function pollMermaid() {
  if (!currentRunId) return;
  const data = await fetchMermaid(currentRunId);
  if (!data) return;
  const key = mermaidPollKey(data);
  if (key === lastMermaidKey) return;
  lastMermaidKey = key;

  const mp = document.getElementById("mermaidPre");
  const bm = document.getElementById("btnCopyMermaid");
  if (data.mermaid) {
    mp.textContent = data.mermaid;
    bm.hidden = false;
    renderMermaidDiagram(data.mermaid);
  } else {
    mp.textContent = MERMAID_PLACEHOLDER;
    bm.hidden = true;
    renderMermaidDiagram("");
  }
}

function setPathHint(text) {
  document.getElementById("pathHint").textContent = text;
}

function applyPlanToForm(plan) {
  if (!plan) return;
  document.getElementById("numAgents").value = String(plan.num_agents ?? 3);
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
    "Plan applied — review Advanced options if needed, then Start run (or start again to refresh the plan).";
  const target = document.getElementById("targetPath").value.trim();
  const query = document.getElementById("planQuery").value.trim();
  lastPlanOkKey = `${target}\n${query}`;
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
      wt.checked = false;
      wt.disabled = true;
      return;
    }
    try {
      const r = await fetch(
        `/api/target-inspect?path=${encodeURIComponent(p)}`,
      );
      const j = await r.json();
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
  const titleEl = document.getElementById("sessionTitle");
  const label = meta.label || meta.run_id || "Session";
  titleEl.textContent = label;

  const parts = [
    st.phase && `Phase: ${st.phase}`,
    st.score != null && `Score: ${st.score}`,
    meta.status && `Archive: ${meta.status}`,
  ].filter(Boolean);
  document.getElementById("statusLine").textContent =
    parts.join(" · ") || "Receiving testimony…";

  renderTrack(snap);
  mergeAgents(snap);
  setDebaterMoods(snap);

  const mer = snap.debate_graph_mermaid;
  const mp = document.getElementById("mermaidPre");
  const bm = document.getElementById("btnCopyMermaid");
  const wrap = document.getElementById("mermaidWrap");
  if (currentRunId) wrap.hidden = false;
  if (mer) {
    bm.hidden = false;
    mp.textContent = mer;
    lastMermaidKey = null;
    renderMermaidDiagram(mer);
  }

  const ipWrap = document.getElementById("improvementPlanWrap");
  const ipPre = document.getElementById("improvementPlanPre");
  const ipCopy = document.getElementById("btnCopyImprovement");
  const ipp = snap.improvement_plan_preview;
  if (ipp && String(ipp).trim() && currentRunId) {
    ipWrap.hidden = false;
    ipPre.textContent = ipp;
    ipCopy.hidden = false;
  } else {
    ipWrap.hidden = true;
    ipPre.textContent = "";
    ipCopy.hidden = true;
  }
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
}

async function pollSnapshot() {
  if (!currentRunId) return;
  try {
    const snap = await fetchSnapshot(currentRunId);
    applySnapshot(snap);
    const tick = document.getElementById("pollTick");
    if (tick) tick.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch {
    document.getElementById("statusLine").textContent = "Snapshot error";
  }
}

async function refreshRunSelect() {
  const runs = await fetchRuns();
  const sel = document.getElementById("runPick");
  const cur = sel.value;
  sel.innerHTML = '<option value="">— New run —</option>';
  for (const x of runs) {
    const id = x.run_id || x.label;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${x.label || id.slice(0, 8)} (${x.status || "?"})`;
    sel.appendChild(opt);
  }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function resetStageIdle() {
  document.getElementById("sessionTitle").textContent = "No session";
  document.getElementById("statusLine").textContent =
    "Pick a run from history or start one from the left.";
  document.getElementById("track").innerHTML = "";
  document.getElementById("streamPre").textContent = "";
  const wrap = document.getElementById("mermaidWrap");
  const mp = document.getElementById("mermaidPre");
  const bm = document.getElementById("btnCopyMermaid");
  const host = document.getElementById("mermaidDiagram");
  wrap.hidden = true;
  bm.hidden = true;
  mp.textContent = "";
  if (host) host.innerHTML = "";
  lastMermaidKey = null;
  mermaidRenderSeq += 1;
  const ipWrap = document.getElementById("improvementPlanWrap");
  const ipPre = document.getElementById("improvementPlanPre");
  const ipCopy = document.getElementById("btnCopyImprovement");
  if (ipWrap) ipWrap.hidden = true;
  if (ipPre) ipPre.textContent = "";
  if (ipCopy) ipCopy.hidden = true;
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
  await refreshRunSelect();
  if (id) {
    document.getElementById("runPick").value = id;
    setHallLive(true);
    document.getElementById("streamPre").textContent = "";
    streamLineAfter = 0;
    stopTimers();
    prepareMermaidPanelForRun();
    pollSnapshot();
    pollStream();
    pollMermaid();
    snapshotTimer = setInterval(pollSnapshot, 1100);
    streamTimer = setInterval(pollStream, 450);
    mermaidTimer = setInterval(pollMermaid, 300);
  } else {
    setHallLive(false);
    stopTimers();
    resetStageIdle();
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
    location.hash = `/run/${v}`;
  } else {
    location.hash = "";
    onRoute();
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

    const agents = parseInt(document.getElementById("numAgents").value, 10) || 3;
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
    location.hash = `/run/${j.run_id}`;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnCopyAll").addEventListener("click", async () => {
  const a = document.getElementById("streamPre").textContent;
  const b = document.getElementById("mermaidPre").textContent;
  const c = document.getElementById("improvementPlanPre").textContent;
  let text = a;
  if (c?.trim()) text += `\n\n--- improvement plan ---\n${c}`;
  if (b?.trim()) text += `\n\n--- mermaid ---\n${b}`;
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("statusLine").textContent = "Copied to clipboard.";
  } catch {
    document.getElementById("statusLine").textContent = "Copy failed — select text manually.";
  }
});

document.getElementById("btnCopyMermaid").addEventListener("click", async () => {
  const b = document.getElementById("mermaidPre").textContent;
  try {
    await navigator.clipboard.writeText(b);
  } catch (_) {}
});

document.getElementById("btnCopyImprovement").addEventListener("click", async () => {
  const t = document.getElementById("improvementPlanPre").textContent;
  try {
    await navigator.clipboard.writeText(t);
    document.getElementById("statusLine").textContent = "Roadmap copied.";
  } catch (_) {}
});

window.addEventListener("hashchange", onRoute);

setPathHint(HINT);
scheduleTargetInspect();
onRoute();
setInterval(refreshRunSelect, 20000);
