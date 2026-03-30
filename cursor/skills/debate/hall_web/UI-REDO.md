# Debate Hall UI redo — spec from `plan-hand.png` only

**Canonical mockup (do not replace with prose):**  
`%AGENT_SKILLS_ROOT%\cursor\skills\debate\hall_web\plan-hand.png`  
Expanded (this machine): `C:\Users\rentk\mihir\agent-skills\cursor\skills\debate\hall_web\plan-hand.png`

This document is **not** a product wishlist. It begins as a **literal inventory of what the drawing shows**. A second part (**Implementation overlay**) adds **states, errors, and edge behavior** that the sketch does not draw but a shippable UI still needs — expressed **only** as variations **within** slides 1–3 (no fourth top-level screen unless `plan-hand.png` is updated).

---

## Flow (exactly as drawn)

The image shows **three** stages, **1 → 2 → 3**, connected by arrows. There is **no** fourth screen, **no** alternate path drawn, and **no** sub-flows.

| Order | What the slide is |
|------:|-------------------|
| 1 | Entry |
| 2 | Active session |
| 3 | Completion modal |

Implementation must be expressible as: **Screen 1 → Screen 2 → Screen 3** (with back/close only if the sketch implies it; the sketch shows **stop** on screen 2 and **X** on the modal).

---

## Slide 1 (labeled `1` on the sketch)

**Title in header (written on the frame):** `Town Hall`

**Primary control (center):** One rectangular control whose handwritten label is **directory choice** (reads as **“Dir chose”** / directory pick — not a separate feature name).

**Below that:** The words **“recent history”** — a region for recent history associated with the above.

**Transition drawn:** An arrow from this screen toward slide 2 (directory chosen / proceed).

**Strict reading:** Slide 1 is only: header title + one dir action + recent history + forward arrow. No sidebar, no graph, no chat, no agents strip.

---

## Slide 2 (labeled `2` on the sketch)

**Title in header:** `Town Hall`

**Top right:** A control marked **stop** (drawn as a square with **X**).

**Left column:**

- A block labeled **Choose dir** containing **three** small shapes (icons).  
- An annotation pointing at them: **“Agent 3 of em”** — meaning **three** agents, shown here (not more, not fewer in this strip).

**Main area (center):** A large panel showing a **graph**: **nodes (circles) and edges (lines)** — the debate / argument structure as a network.

**Bottom band (single horizontal strip):**

- On the **left end:** label **Details**  
- **Center / wide:** **Latest chat**  
- On the **right:** a control labeled **option**

**Handwritten note under that band (function of the strip):**  
**“Latest input / argument in debate + option to input argument”**  
So this strip must both **show** the latest debate input/argument and **offer** a way for the user to **input** an argument (the **option** control).

**Transition drawn:** A large arrow from this screen toward slide 3.

**Strict reading:** Slide 2 = header + stop + left (choose dir + 3 agent glyphs + details/chat/option layout as drawn) + central graph + bottom strip exactly as labeled. No extra panels unless they appear in the PNG.

---

## Slide 3 (labeled `3` on the sketch)

**Component type:** A **Modal** (the word **Modal** is written on the frame).

**Chrome:** Close **X** top-right (same idea as stop’s X on slide 2).

**Body copy inside the modal:** **“plan created”**

**Strict reading:** Slide 3 is only this modal and that string. No secondary tabs, no wizard steps drawn.

---

## Foundation rules (non-negotiable)

1. **Three slides only** — numbering and arrows match the image.  
2. **Labels matter** — UI copy and section names should match the sketch (`Town Hall`, `Dir chose`, `recent history`, `stop`, `Choose dir`, `Details`, `Latest chat`, `option`, `Modal`, `plan created`, and the three-agent note).  
3. **No roundabout** — do not “improve” the flow into a different IA (e.g. extra dashboard, separate settings app) without updating **plan-hand.png** first.  
4. **Graph is central on slide 2** — the node–link diagram is the focal panel, not an appendix.  
5. **Bottom strip is dual purpose** — show latest debate line **and** user argument input path via **option**, per the handwritten note.  
6. **Shipping detail** — errors, loading, empty states, a11y, and nested dialogs are allowed only as described in **Implementation overlay** (still slides **1–3**).

---

## Mapping note (current Hall vs slides)

Today’s `hall_web` mixes convene form, roll, clerk record, and run view in one shell. **This spec does not describe today’s layout**; it describes **only** the three drawings. Refactor plans must **collapse or re-home** existing pieces so the running UI can be described as slides **1 → 2 → 3** above.

---

## Open questions (must be resolved against the PNG, not against taste)

- Handwriting on the directory control: confirm in the PNG whether the center box reads **Dir chose** vs another phrase (keep the bitmap as tie-breaker).  
- Whether **Details** is a column above the bottom strip or only the left label of the bottom strip — **follow the drawing’s geometry**, not a cleaner grid.  
- **option** interaction pattern: pick one of inline composer / bottom sheet / small modal **nested inside slide 2** (see overlay §2.5); must still satisfy **input argument**.

---

## Implementation overlay (slides 1–3 only)

The mockup shows a **happy path**. Below: what to design **without** inventing a new numbered slide. Prefer **inline state** (same regions, different content/disabled chrome) over new routes.

### 1. Slide 1 — states and behavior

| Topic | Requirement |
|--------|----------------|
| **Directory affordance** | Clarify in UI (tooltip or microcopy) how **Dir chose** works: native picker, text field + validate, or both — still a **single** primary control in the center. |
| **Validation / errors** | Invalid path, not a directory, permission denied → **message inline on slide 1** (below control or under **recent history**). No error “page.” |
| **Loading** | While validating path or handoff to session start → **same layout**; center or list shows spinner / “Opening…” — still slide 1. |
| **Empty recent history** | First visit: **recent history** region visible with empty state copy (“No prior assemblies yet”) — not hidden. |
| **Proceed** | Success transitions to slide 2 only when a directory is accepted and a run/session can attach (align with existing `POST /api/runs` flow). |

### 2. Slide 2 — states and behavior

| Topic | Requirement |
|--------|----------------|
| **Session phase** | User must see **what is happening** (e.g. scan/evaluate, sequential debate, plan, idle) **without leaving slide 2** — via header subtitle, **Details** panel, or one line in **Latest chat**. |
| **Graph: loading / empty** | Before graph data exists: center shows **placeholder** (“Graph will appear as the debate progresses”) or skeleton — still the **graph panel**. |
| **Graph: error** | Failed to load or parse graph: short message **in center** or **Details**; optional retry — still slide 2. |
| **Latest chat** | Match sketch intent: emphasize **latest input / argument**, not an unbounded wall of log. Default: **last meaningful line** + control to **expand** full tail in-place (accordion, same strip height growth, or drawer **over** slide 2 — not a new numbered slide). |
| **Stop (X)** | Define semantics: e.g. **stop agents** (hall keeps running) vs **end run** vs **both** — document one behavior; show confirmation only if destructive to data (confirm as **small nested dialog** over slide 2, not slide 4). |
| **Failures** | Agent timeout, hall disconnect, run error → status in **Details** + optional line in **Latest chat**; **recover** via stop + return to slide 1 or retry path **from slide 2**. |
| **Choose dir + 3 agents** | Left strip: **three** distinct glyphs always map to **Alex / Jordan / Sam** (or slots 0–2); reflect **idle / running / done** per debater. **Choose dir** may open picker or navigate back to slide 1 **without** adding a new slide type (treat return to slide 1 as “back” to entry). |

#### 2.5 **option** (user argument input)

Must satisfy handwritten note: user can **inject** an argument. Pick one primary pattern (decision in Open questions):

- **A)** **option** expands **Latest chat** into a composer (text + send) inline.  
- **B)** **option** opens a **bottom sheet** over slide 2.  
- **C)** **option** opens a **small modal** (nested) with textarea + submit.

**Product rule:** injected text must be defined against backend (e.g. append to motion, `events.jsonl` user line, or queued message for next phase) — wire explicitly in implementation tasks.

### 3. Slide 3 — modal: beyond the two words

The drawing shows **“plan created”** only. For usability, **same modal** may include **secondary actions** (still one modal, one focus):

| Element | Purpose |
|---------|---------|
| Headline | Keep **plan created** when `improvement-plan.md` succeeded. |
| Variant copy | If plan **missing or partial** (timeout/error): **honest** headline (e.g. “Plan incomplete” / “No plan file”) — same modal component. |
| Body | Short summary or first lines of plan / link to open **improvement plan** preview (markdown). |
| Actions | **Open / Copy link / Close** (Close returns to slide 2 **or** slide 1 per product choice — document one default). |
| **X** | Dismiss modal; state behind it must be consistent (e.g. run complete, stay on slide 2). |

No wizard steps inside the modal unless added to **plan-hand.png**.

### 4. Cross-slide navigation and URLs

| Topic | Requirement |
|--------|----------------|
| **Back from slide 2 → slide 1** | Not drawn but expected: **change directory** / new assembly — explicit control (e.g. under **Choose dir** or header) returning to slide 1 **without** a new slide ID. |
| **Deep links** | Existing `#/run/<id>` (or equivalent) should **land on slide 2** with that run loaded; slide 1 when no run. |
| **Modal (slide 3)** | Can be triggered by **auto** (plan ready, deadline) or **user**; opening modal does not change “current slide” index — treat as **overlay on slide 2**. |

### 5. Accessibility (non-visual sketch)

Still within the same three layouts:

- **Focus order:** slide 1 center → history → primary action; slide 2 stop → left rail → graph container → Details → Latest chat → option; modal X → primary action.  
- **Live updates:** **Latest chat** (or a polite `aria-live` region) for new agent lines.  
- **Stop / option:** keyboard operable, visible focus, `aria-label` where icon-only.  
- **Graph:** accessible name for the canvas; list or table **fallback** or skip link for screen readers if graph is purely visual (document choice).

### 6. Mapping to current Hall features (for refactor)

Rough alignment so nothing is orphaned:

| Sketch region | Current / API (today) |
|---------------|------------------------|
| Slide 1 **Dir chose** + **recent history** | Target path + roll / saved paths (`localStorage` / registry). |
| Slide 2 **graph** | `debate_track` + vis-network + `/api/runs/:id/mermaid`. |
| Slide 2 **Latest chat** | `stream.jsonl` / snapshot stream tail / events. |
| Slide 2 **Details** | `meta.json`, git badge, phase, timers, scores. |
| Slide 2 **stop** | `POST /api/hall/stop-agents` + optional run cancel semantics. |
| Slide 3 **plan created** | `improvement-plan.md` present + modal; variants per §3. |

---

*Last anchored to file:* `cursor/skills/debate/hall_web/plan-hand.png` (under `AGENT_SKILLS_ROOT`) — if the image changes, this spec must be re-verified line by line against the new bitmap.
