const ORDER = [
  "starting",
  "scan_evaluate",
  "scan_evaluate_done",
  "aggregating",
  "aggregating_done",
  "voting",
  "voting_done",
  "tally_done",
  "complete",
];

const POLL_MS = 750;
const POLL_MS_DONE = 4000;

let startedAt = Date.now();

function phaseRank(phase) {
  if (phase === "failed") return -1;
  const i = ORDER.indexOf(phase);
  return i >= 0 ? i : 0;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function renderTimeline(phase) {
  const el = document.getElementById("phaseTimeline");
  const isFailed = phase === "failed";
  const r = phaseRank(phase);

  const steps = [
    { label: "Start", from: 0, until: 0 },
    { label: "Evaluate", from: 1, until: 2 },
    { label: "Aggregate", from: 3, until: 4 },
    { label: "Vote", from: 5, until: 6 },
    { label: "Tally", from: 7, until: 7 },
    { label: "Complete", from: 8, until: 8 },
  ];

  el.innerHTML = steps
    .map(({ label, from, until }) => {
      let cls = "phase-step";
      if (isFailed) cls += " failed";
      else if (r > until) cls += " done";
      else if (r >= from && r <= until) cls += " active";
      return `<span class="${cls}">${label}</span>`;
    })
    .join("");
}

function renderChips(status) {
  const wrap = document.getElementById("summaryChips");
  const parts = [];
  if (status.num_agents != null) {
    parts.push(`<span class="chip"><strong>Agents</strong>${status.num_agents}</span>`);
  }
  if (status.findings_raw != null) {
    parts.push(
      `<span class="chip"><strong>Raw findings</strong>${status.findings_raw}</span>`,
    );
  }
  if (status.findings_deduped != null) {
    parts.push(
      `<span class="chip"><strong>Deduped</strong>${status.findings_deduped}</span>`,
    );
  }
  if (status.scan_summary?.project_name) {
    parts.push(
      `<span class="chip"><strong>Project</strong>${escapeHtml(status.scan_summary.project_name.slice(0, 48))}${status.scan_summary.project_name.length > 48 ? "…" : ""}</span>`,
    );
  }
  if (
    status.findings_count != null &&
    (status.phase === "voting" || status.phase === "voting_done")
  ) {
    parts.push(
      `<span class="chip"><strong>Voting on</strong>${status.findings_count}</span>`,
    );
  }
  if (status.score != null) {
    parts.push(
      `<span class="chip score"><strong>Score</strong>${status.score}/100 — ${status.rating || ""}</span>`,
    );
  }
  if (status.clean_bill) {
    parts.push(`<span class="chip"><strong>Result</strong>Clean bill (no findings)</span>`);
  }
  wrap.innerHTML = parts.join("") || '<span class="chip">Waiting…</span>';
}

function pickAgents(status) {
  if (Array.isArray(status.agents) && status.agents.length) return status.agents;
  const out = [];
  if (Array.isArray(status.eval_agents)) {
    for (const a of status.eval_agents) {
      out.push({ ...a, phaseLabel: "Eval" });
    }
  }
  if (Array.isArray(status.vote_agents)) {
    for (const a of status.vote_agents) {
      out.push({ ...a, phaseLabel: "Vote" });
    }
  }
  return out;
}

function renderAgents(agents) {
  const wrap = document.getElementById("agentCards");
  if (!agents || !agents.length) {
    wrap.innerHTML = '<p class="hint">No agent rows yet.</p>';
    return;
  }
  wrap.innerHTML = agents
    .map((a) => {
      const st = a.status || "pending";
      const prefix = a.phaseLabel ? `${a.phaseLabel} · ` : "";
      return `<div class="agent-card">
        <h3>${escapeHtml(prefix)}${escapeHtml(a.name || `Agent ${(a.slot ?? 0) + 1}`)}</h3>
        <span class="agent-status ${st}">${escapeHtml(st)}</span>
        ${a.elapsed != null ? `<div class="hint">Elapsed: ${a.elapsed}s</div>` : ""}
        ${a.error ? `<div class="agent-err">${escapeHtml(a.error)}</div>` : ""}
      </div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLogs(logTails) {
  const wrap = document.getElementById("logAccordions");
  const names = Object.keys(logTails || {}).sort();
  if (!names.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = names
    .map((name) => {
      const body = logTails[name] || "";
      return `<details class="log-acc">
        <summary>${escapeHtml(name)}</summary>
        <pre>${escapeHtml(body)}</pre>
      </details>`;
    })
    .join("");
}

function renderTranscript(events) {
  let el = document.getElementById("transcriptFeed");
  if (!el) {
    el = document.createElement("section");
    el.id = "transcriptFeed";
    el.className = "transcript-mini";
    el.innerHTML = "<h2>Transcript</h2><div class=\"feed-mini\"></div>";
    document.getElementById("logSection").before(el);
  }
  const feed = el.querySelector(".feed-mini");
  if (!feed) return;
  const lines = (events || []).filter((e) => e.kind === "stage_output");
  if (!lines.length) {
    feed.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  feed.innerHTML = lines
    .map(
      (e) =>
        `<div class="tline"><strong>${escapeHtml(e.title || e.stage)}</strong> — ${escapeHtml((e.subtitle || "").slice(0, 120))}</div>`,
    )
    .join("");
}

function renderReport(snap) {
  const sec = document.getElementById("reportSection");
  const pre = document.getElementById("reportPre");
  if (snap.report_preview) {
    sec.hidden = false;
    pre.textContent = snap.report_preview;
  } else if (snap.has_report) {
    sec.hidden = false;
    pre.textContent = "(Report file present; preview empty.)";
  } else {
    sec.hidden = true;
    pre.textContent = "";
  }
}

function terminalPhase(phase) {
  return phase === "complete" || phase === "failed";
}

async function poll() {
  const statusEl = document.getElementById("pollStatus");
  try {
    const r = await fetch("/api/snapshot", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const snap = await r.json();
    const status = snap.status || {};
    const phase = status.phase || "unknown";

    document.getElementById("targetLabel").textContent =
      status.target || "—";
    document.getElementById("elapsedLabel").textContent = formatElapsed(
      Date.now() - startedAt,
    );

    renderTimeline(phase);
    renderChips(status);
    renderAgents(pickAgents(status));
    renderLogs(snap.log_tails);
    renderTranscript(snap.events || []);
    renderReport(snap);

    statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    return terminalPhase(phase);
  } catch (e) {
    statusEl.textContent = `Poll error: ${e.message}`;
    return false;
  }
}

function loop() {
  let done = false;
  const tick = async () => {
    done = await poll();
    setTimeout(tick, done ? POLL_MS_DONE : POLL_MS);
  };
  tick();
}

loop();
