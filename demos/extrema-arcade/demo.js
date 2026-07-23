"use strict";

/*
 * Extrema Arcade
 * A curve scrolls past. Each marked point freezes in the central gate; the
 * player names it — local max, local min, global max, global min, or neither —
 * before it scrolls away.
 *
 * "Global" is judged over the CURRENT SCREEN: the window between the left and
 * right edges (a fixed VISIBLE_UNITS-wide slice of the domain, clamped to it).
 * A frozen turning point is the global max/min when it is the highest/lowest
 * thing anywhere in that window; otherwise it is only local.
 *
 * Correctness rule: the answer key is derived from the SAME f(x) that is drawn.
 * Turning points come from sign changes of a numerical f'; horizontal
 * inflections and fake decoy points are "neither"; global vs local is decided
 * by scanning f across the visible window. Each point's answer is precomputed
 * and re-verifiable.
 */

const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d");

const el = {
  score: document.querySelector("#score"),
  streak: document.querySelector("#streak"),
  accuracy: document.querySelector("#accuracy"),
  level: document.querySelector("#level"),
  playpause: document.querySelector("#playpause"),
  restart: document.querySelector("#restart"),
  calmToggle: document.querySelector("#calm-toggle"),
  guidance: document.querySelector("#guidance"),
  guidanceToggle: document.querySelector("#guidance-toggle"),
  classify: document.querySelector("#classify"),
  choiceButtons: Array.from(document.querySelectorAll(".choice-button")),
  prompt: document.querySelector("#prompt"),
  flash: document.querySelector("#flash"),
  startOverlay: document.querySelector("#start-overlay"),
  startButton: document.querySelector("#start-button"),
  summaryOverlay: document.querySelector("#summary-overlay"),
  summaryTitle: document.querySelector("#summary-title"),
  summaryEyebrow: document.querySelector("#summary-eyebrow"),
  summaryStats: document.querySelector("#summary-stats"),
  nextLevel: document.querySelector("#next-level"),
  replayLevel: document.querySelector("#replay-level"),
};

const palette = {
  graphite: "#20242a",
  grid: "#dce4e6",
  gridStrong: "#9cabb3",
  blue: "#1769aa",
  blueWash: "rgba(23, 105, 170, 0.14)",
  orange: "#d96c24",
  orangeWash: "rgba(217, 108, 36, 0.18)",
  green: "#2b7a55",
  greenWash: "rgba(43, 122, 85, 0.18)",
  white: "#ffffff",
  muted: "#57636d",
};

// The screen shows this many domain units at once; "global" is judged over it.
const VISIBLE_UNITS = 12;
const MONO = '"Cascadia Mono", Consolas, monospace';

const GRADE_LABEL = {
  lmax: "local max",
  lmin: "local min",
  gmax: "global max",
  gmin: "global min",
  neither: "neither",
};
const KEY_TO_GRADE = { 1: "lmax", 2: "lmin", 3: "gmax", 4: "gmin", 5: "neither" };

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

// ---------------------------------------------------------------------------
// Deterministic PRNG so a given level index is reproducible and verifiable.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Curve pieces. f(x) = sum of features on a flat baseline.
//   bump : +/- a * exp(-u^2)        -> one clean local extremum at the centre
//   shelf:      s * u^3 * exp(-u^2)  -> horizontal inflection (neither)
// where u = (x - c) / w.
// ---------------------------------------------------------------------------
function bumpFn(c, w, a) {
  return (x) => {
    const u = (x - c) / w;
    return a * Math.exp(-u * u);
  };
}

function derivative(f, x) {
  const e = 1e-4;
  return (f(x + e) - f(x - e)) / (2 * e);
}

// ---------------------------------------------------------------------------
// Level construction.
// ---------------------------------------------------------------------------
function makeLevel(levelIndex) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rand = mulberry32((levelIndex * 100003 + attempt * 7919 + 17) >>> 0);
    const level = tryBuildLevel(levelIndex, rand);
    if (level) return level;
  }
  return buildFallbackLevel();
}

function tryBuildLevel(levelIndex, rand) {
  const featureCount = Math.min(4 + Math.floor(levelIndex / 2), 7);
  const spacing = 2.8;
  const margin = 2.5;
  const L = margin * 2 + spacing * (featureCount - 1);

  const terms = [];
  let sign = rand() < 0.5 ? 1 : -1;

  for (let i = 0; i < featureCount; i += 1) {
    const c = margin + i * spacing + (rand() - 0.5) * 0.4;
    const w = 0.8 + rand() * 0.25;
    // Varied amplitudes so some peaks/valleys clearly win their window (global)
    // and others clearly do not (local).
    const a = sign * (1.6 + rand() * 2.6);
    terms.push(bumpFn(c, w, a));
    sign = -sign;
  }

  const f = (x) => {
    let y = 0;
    for (const term of terms) y += term(x);
    return y;
  };

  const criticals = findCritical(f, L, []);
  const maxima = criticals.filter((p) => p.base === "max");
  const minima = criticals.filter((p) => p.base === "min");
  if (maxima.length < 1 || minima.length < 1) return null;

  // Reject pathologically close critical points: a sub-unit wiggle is invisible,
  // its markers overlap, and it is unfair to classify under time pressure.
  for (let i = 1; i < criticals.length; i += 1) {
    if (criticals[i].x - criticals[i - 1].x < 1.4) return null;
  }

  // Grade each turning point over its centred screen window. Reject the level
  // if any grade is visually ambiguous.
  let sawGlobalMax = false;
  let sawGlobalMin = false;
  for (const p of criticals) {
    if (p.base === "neither") {
      p.grade = "neither";
      continue;
    }
    const grade = gradeExtremum(f, p, L);
    if (grade === "ambiguous") return null;
    p.grade = grade;
    if (grade === "gmax") sawGlobalMax = true;
    if (grade === "gmin") sawGlobalMin = true;
  }
  // Each level should exercise both global labels once it is past the intro.
  if (levelIndex >= 2 && (!sawGlobalMax || !sawGlobalMin)) return null;

  const fakes = makeFakes(f, L, criticals, fakeCount(levelIndex));
  const pois = criticals.concat(fakes).sort((a, b) => a.x - b.x);
  if (pois.length < 3) return null;

  let yMin = Infinity;
  let yMax = -Infinity;
  const scan = 500;
  for (let i = 0; i <= scan; i += 1) {
    const y = f((i / scan) * L);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  return { index: levelIndex, L, f, pois, yMin: yMin - 0.7, yMax: yMax + 0.7 };
}

function fakeCount(levelIndex) {
  if (levelIndex < 2) return 0;
  return Math.min(1 + Math.floor((levelIndex - 2) / 2), 3);
}

function buildFallbackLevel() {
  const L = 12;
  const f = (x) =>
    3 * Math.exp(-((x - 4) * (x - 4))) - 3 * Math.exp(-((x - 8) * (x - 8)));
  const criticals = findCritical(f, L, []);
  for (const p of criticals) {
    p.grade = p.base === "max" ? "gmax" : p.base === "min" ? "gmin" : "neither";
  }
  return { index: 1, L, f, pois: criticals, yMin: -4, yMax: 4 };
}

// Detect turning points (sign changes of f') and label shelves as "neither".
function findCritical(f, L, shelfCenters) {
  const points = [];
  const steps = 2600;
  const dx = L / steps;
  let prevX = 0;
  let prevD = derivative(f, prevX);

  for (let i = 1; i <= steps; i += 1) {
    const x = i * dx;
    const d = derivative(f, x);
    const nearShelf = shelfCenters.some((c) => Math.abs(x - c) < 0.5);

    if (!nearShelf && prevD === 0) prevD = d;
    if (!nearShelf && Math.sign(d) !== Math.sign(prevD) && prevD !== 0) {
      const root = bisectDerivative(f, prevX, x);
      if (root > 0.25 && root < L - 0.25) {
        const base = prevD > 0 && d < 0 ? "max" : "min";
        points.push({ x: root, y: f(root), base });
      }
    }
    prevX = x;
    prevD = d;
  }

  for (const c of shelfCenters) {
    const dL = derivative(f, c - 0.6);
    const dR = derivative(f, c + 0.6);
    if (Math.sign(dL) === Math.sign(dR)) {
      points.push({ x: c, y: f(c), base: "neither" });
    }
  }

  points.sort((a, b) => a.x - b.x);
  return points;
}

function bisectDerivative(f, lo, hi) {
  let a = lo;
  let b = hi;
  let da = derivative(f, a);
  for (let i = 0; i < 60; i += 1) {
    const m = (a + b) / 2;
    const dm = derivative(f, m);
    if (dm === 0) return m;
    if (Math.sign(dm) === Math.sign(da)) {
      a = m;
      da = dm;
    } else {
      b = m;
    }
  }
  return (a + b) / 2;
}

function windowBounds(x, L) {
  return [Math.max(0, x - VISIBLE_UNITS / 2), Math.min(L, x + VISIBLE_UNITS / 2)];
}

// Compare a turning point against the best OTHER thing in its screen window.
function gradeExtremum(f, p, L) {
  const [lo, hi] = windowBounds(p.x, L);
  const n = 320;
  const dx = (hi - lo) / n;
  let otherMax = -Infinity;
  let otherMin = Infinity;
  for (let i = 0; i <= n; i += 1) {
    const x = lo + i * dx;
    if (Math.abs(x - p.x) < 0.8) continue; // ignore the point itself
    const y = f(x);
    if (y > otherMax) otherMax = y;
    if (y < otherMin) otherMin = y;
  }
  const yp = f(p.x);
  const margin = 0.4;
  if (p.base === "max") {
    if (yp - otherMax > margin) return "gmax";
    if (otherMax - yp > margin) return "lmax";
    return "ambiguous";
  }
  if (otherMin - yp > margin) return "gmin";
  if (yp - otherMin > margin) return "lmin";
  return "ambiguous";
}

// Fake decoy points: highlighted like real ones, but not turning points at all
// (the curve is clearly rising or falling through them). Answer: "neither".
function makeFakes(f, L, criticals, count) {
  if (count <= 0) return [];
  const fakes = [];
  const xs = criticals.map((c) => c.x).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 0; i < xs.length - 1; i += 1) gaps.push((xs[i] + xs[i + 1]) / 2);
  gaps.sort((a, b) => Math.abs(derivative(f, b)) - Math.abs(derivative(f, a)));

  for (const gx of gaps) {
    if (fakes.length >= count) break;
    if (gx < 0.8 || gx > L - 0.8) continue;
    if (Math.abs(derivative(f, gx)) < 0.9) continue; // must be clearly sloped
    if (criticals.some((c) => Math.abs(c.x - gx) < 1.2)) continue;
    if (fakes.some((fk) => Math.abs(fk.x - gx) < 1.6)) continue;
    fakes.push({ x: gx, y: f(gx), base: "neither", grade: "neither", fake: true });
  }
  return fakes;
}

// ---------------------------------------------------------------------------
// Game state.
// ---------------------------------------------------------------------------
const PHASE = {
  START: "start",
  SCROLL: "scroll",
  FROZEN: "frozen",
  RESULT: "result",
  SUMMARY: "summary",
};

function freshByType() {
  return { lmax: [0, 0], lmin: [0, 0], gmax: [0, 0], gmin: [0, 0], neither: [0, 0] };
}

const state = {
  phase: PHASE.START,
  level: null,
  levelIndex: 1,
  camera: 0,
  targetIndex: 0,
  freezeRemaining: 0,
  freezeTotal: 0,
  resultRemaining: 0,
  lastResult: null,
  paused: false,
  calm: prefersReducedMotion,
  score: 0,
  streak: 0,
  bestStreak: 0,
  attempts: 0,
  correct: 0,
  byType: freshByType(),
  pxPerUnitX: 60,
  visibleUnits: VISIBLE_UNITS,
};

let rafId = null;
let lastTime = null;

// ---------------------------------------------------------------------------
// Layout helpers.
// ---------------------------------------------------------------------------
function plotBox() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pad = { top: 24, right: 24, bottom: 74, left: 24 };
  return {
    width,
    height,
    pad,
    innerW: width - pad.left - pad.right,
    innerH: height - pad.top - pad.bottom,
    cx: pad.left + (width - pad.left - pad.right) / 2,
  };
}

function yToScreen(y) {
  const box = plotBox();
  const { yMin, yMax } = state.level;
  return box.pad.top + ((yMax - y) / (yMax - yMin)) * box.innerH;
}

function worldToScreenX(x) {
  const box = plotBox();
  return box.cx + (x - state.camera) * state.pxPerUnitX;
}

function screenToWorldX(sx) {
  const box = plotBox();
  return state.camera + (sx - box.cx) / state.pxPerUnitX;
}

function computeScale() {
  const box = plotBox();
  state.pxPerUnitX = box.innerW / state.visibleUnits;
}

// ---------------------------------------------------------------------------
// Level lifecycle.
// ---------------------------------------------------------------------------
function loadLevel(index) {
  state.level = makeLevel(index);
  state.levelIndex = index;
  state.targetIndex = 0;
  state.byType = freshByType();
  computeScale();
  state.camera = state.level.pois[0].x - state.visibleUnits * 0.5;
  state.freezeTotal = Math.max(2.2, 4.0 - index * 0.16);
  beginScrollToTarget();
  updateHud();
}

function beginScrollToTarget() {
  if (state.targetIndex >= state.level.pois.length) {
    finishLevel();
    return;
  }
  state.phase = PHASE.SCROLL;
  setClassifyEnabled(false);
  if (state.calm) {
    state.camera = state.level.pois[state.targetIndex].x;
    enterFrozen();
  } else {
    setPrompt("Watch for the next point…");
  }
}

function enterFrozen() {
  state.phase = PHASE.FROZEN;
  state.freezeRemaining = state.freezeTotal;
  setClassifyEnabled(true);
  const poi = state.level.pois[state.targetIndex];
  setPrompt(
    state.calm
      ? "Classify: 1 local max, 2 local min, 3 global max, 4 global min, 5 neither."
      : "Freeze! Name it before the timer empties."
  );
  announce(
    `A point is frozen near x ${poi.x.toFixed(1)}, height ${poi.y.toFixed(1)}. ` +
      "Compare it against the whole screen, then press 1 local max, 2 local min, " +
      "3 global max, 4 global min, or 5 neither."
  );
}

function submitClassification(choice) {
  if (state.phase !== PHASE.FROZEN) return;
  const poi = state.level.pois[state.targetIndex];
  const correct = choice === poi.grade;

  state.attempts += 1;
  state.byType[poi.grade][1] += 1;
  if (correct) {
    state.byType[poi.grade][0] += 1;
    state.correct += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const timeBonus = state.calm
      ? 0
      : Math.round(40 * (state.freezeRemaining / state.freezeTotal));
    const comboMult = 1 + Math.min(state.streak - 1, 9) * 0.2;
    state.score += Math.round((100 + timeBonus) * comboMult);
  } else {
    state.streak = 0;
  }

  state.lastResult = { correct, poi, chosen: choice };
  state.resultRemaining = correct ? 0.6 : 1.4;
  state.phase = PHASE.RESULT;
  setClassifyEnabled(false);
  showFlash(
    correct ? "Nice — " + GRADE_LABEL[poi.grade] : "It was " + GRADE_LABEL[poi.grade],
    correct
  );
  announce(
    correct
      ? `Correct. That was a ${GRADE_LABEL[poi.grade]}.`
      : `Not quite. That point was a ${GRADE_LABEL[poi.grade]}.`
  );
  updateHud();
}

function submitTimeout() {
  const poi = state.level.pois[state.targetIndex];
  state.attempts += 1;
  state.byType[poi.grade][1] += 1;
  state.streak = 0;
  state.lastResult = { correct: false, poi, chosen: null };
  state.resultRemaining = 1.4;
  state.phase = PHASE.RESULT;
  setClassifyEnabled(false);
  showFlash("Time — it was " + GRADE_LABEL[poi.grade], false);
  announce(`Time up. That point was a ${GRADE_LABEL[poi.grade]}.`);
  updateHud();
}

function advanceAfterResult() {
  state.targetIndex += 1;
  hideFlash();
  beginScrollToTarget();
}

function finishLevel() {
  state.phase = PHASE.SUMMARY;
  hideFlash();
  const acc = state.attempts ? Math.round((state.correct / state.attempts) * 100) : 0;
  const t = state.byType;
  const globalCorrect = t.gmax[0] + t.gmin[0];
  const globalTotal = t.gmax[1] + t.gmin[1];
  el.summaryEyebrow.textContent = `Level ${state.levelIndex} complete`;
  el.summaryTitle.textContent =
    acc >= 90 ? "Sharp reading." : acc >= 60 ? "Solid — keep going." : "Worth another pass.";
  el.summaryStats.replaceChildren();
  const stats = [
    ["Score", String(state.score)],
    ["Accuracy", acc + "%"],
    ["Best streak", String(state.bestStreak)],
    ["Globals", `${globalCorrect}/${globalTotal}`],
    ["Traps caught", `${t.neither[0]}/${t.neither[1]}`],
  ];
  for (const [label, value] of stats) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    div.append(dt, dd);
    el.summaryStats.append(div);
  }
  el.summaryOverlay.hidden = false;
  announce(`Level complete. Score ${state.score}, accuracy ${acc} percent.`);
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------
function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (state.level) computeScale();
  render();
}

function render() {
  const box = plotBox();
  if (!box.width || !box.height) return;
  context.clearRect(0, 0, box.width, box.height);
  if (!state.level) return;
  renderScroller(box);
}

function renderScroller(box) {
  drawGrid(box);
  drawCurve(box);
  drawGate(box);
  drawPois(box);
}

function drawGrid(box) {
  const xMinWorld = screenToWorldX(box.pad.left);
  const xMaxWorld = screenToWorldX(box.width - box.pad.right);
  context.lineWidth = 1;
  for (let gx = Math.ceil(xMinWorld); gx <= xMaxWorld; gx += 1) {
    const sx = worldToScreenX(gx);
    context.beginPath();
    context.strokeStyle = palette.grid;
    context.moveTo(sx, box.pad.top);
    context.lineTo(sx, box.pad.top + box.innerH);
    context.stroke();
  }
  const { yMin, yMax } = state.level;
  for (let gy = Math.ceil(yMin); gy <= Math.floor(yMax); gy += 1) {
    const sy = yToScreen(gy);
    context.beginPath();
    context.strokeStyle = gy === 0 ? palette.gridStrong : palette.grid;
    context.lineWidth = gy === 0 ? 1.4 : 1;
    context.moveTo(box.pad.left, sy);
    context.lineTo(box.width - box.pad.right, sy);
    context.stroke();
  }
}

function drawCurve(box) {
  context.save();
  context.beginPath();
  context.rect(box.pad.left, box.pad.top, box.innerW, box.innerH);
  context.clip();
  context.beginPath();
  context.strokeStyle = palette.blue;
  context.lineWidth = 3.5;
  context.lineJoin = "round";
  let started = false;
  for (let sx = box.pad.left; sx <= box.width - box.pad.right; sx += 2) {
    const wx = screenToWorldX(sx);
    if (wx < 0 || wx > state.level.L) {
      started = false;
      continue;
    }
    const sy = yToScreen(state.level.f(wx));
    if (!started) {
      context.moveTo(sx, sy);
      started = true;
    } else {
      context.lineTo(sx, sy);
    }
  }
  context.stroke();
  context.restore();
}

function drawGate(box) {
  const gateHalf = 26;
  context.save();
  context.strokeStyle = palette.graphite;
  context.lineWidth = 1.5;
  context.setLineDash([5, 5]);
  for (const gx of [box.cx - gateHalf, box.cx + gateHalf]) {
    context.beginPath();
    context.moveTo(gx, box.pad.top);
    context.lineTo(gx, box.pad.top + box.innerH);
    context.stroke();
  }
  context.setLineDash([]);
  context.restore();
}

function drawPois(box) {
  context.save();
  context.beginPath();
  context.rect(box.pad.left, box.pad.top - 24, box.innerW, box.innerH + 48);
  context.clip();
  state.level.pois.forEach((poi, index) => {
    const sx = worldToScreenX(poi.x);
    if (sx < box.pad.left - 30 || sx > box.width - box.pad.right + 30) return;
    const sy = yToScreen(poi.y);
    const isTarget =
      index === state.targetIndex &&
      (state.phase === PHASE.FROZEN || state.phase === PHASE.RESULT);
    const resolved = index < state.targetIndex;

    if (isTarget && state.phase === PHASE.FROZEN) {
      drawTimerRing(sx, sy);
      drawPoi(sx, sy, palette.orange, palette.orangeWash, 9, true);
    } else if (isTarget && state.phase === PHASE.RESULT) {
      const good = state.lastResult && state.lastResult.correct;
      const color = good ? palette.green : palette.orange;
      const wash = good ? palette.greenWash : palette.orangeWash;
      drawPoi(sx, sy, color, wash, 9, true);
      drawTag(sx, sy - 26, GRADE_LABEL[poi.grade], color);
    } else if (resolved) {
      drawPoi(sx, sy, palette.muted, "rgba(87,99,109,0.12)", 5, false);
    } else {
      drawPoi(sx, sy, palette.blue, palette.blueWash, 6, false);
    }
  });
  context.restore();
}

function drawPoi(sx, sy, color, wash, radius, pulse) {
  context.beginPath();
  context.fillStyle = wash;
  context.arc(sx, sy, pulse ? radius + 12 : radius + 7, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.fillStyle = palette.white;
  context.strokeStyle = color;
  context.lineWidth = 3.5;
  context.arc(sx, sy, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawTimerRing(sx, sy) {
  if (state.calm) return;
  const frac = Math.max(0, state.freezeRemaining / state.freezeTotal);
  context.save();
  context.strokeStyle = "rgba(32,36,42,0.18)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(sx, sy, 20, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = frac > 0.35 ? palette.orange : "#c0392b";
  context.lineWidth = 3.5;
  context.beginPath();
  context.arc(sx, sy, 20, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawTag(sx, sy, text, color) {
  context.font = `700 12px ${MONO}`;
  const w = context.measureText(text).width + 16;
  const h = 20;
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(sx - w / 2, sy - h / 2, w, h, 4);
  context.fill();
  context.fillStyle = palette.white;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, sx, sy + 0.5);
}

// ---------------------------------------------------------------------------
// Animation loop.
// ---------------------------------------------------------------------------
function frame(time) {
  rafId = window.requestAnimationFrame(frame);
  const dt = lastTime == null ? 0 : Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;

  if (!state.paused && state.level) {
    if (state.phase === PHASE.SCROLL && !state.calm) {
      const target = state.level.pois[state.targetIndex].x;
      const speed = 2.6 + state.levelIndex * 0.32;
      const dir = Math.sign(target - state.camera);
      state.camera += dir * speed * dt;
      if ((dir >= 0 && state.camera >= target) || (dir < 0 && state.camera <= target)) {
        state.camera = target;
        enterFrozen();
      }
    } else if (state.phase === PHASE.FROZEN && !state.calm) {
      state.freezeRemaining -= dt;
      if (state.freezeRemaining <= 0) submitTimeout();
    } else if (state.phase === PHASE.RESULT && !state.calm) {
      state.resultRemaining -= dt;
      if (state.resultRemaining <= 0) advanceAfterResult();
    }
  }
  render();
}

// ---------------------------------------------------------------------------
// UI plumbing.
// ---------------------------------------------------------------------------
function updateHud() {
  el.score.textContent = String(state.score);
  el.streak.textContent = String(state.streak);
  el.accuracy.textContent = state.attempts
    ? Math.round((state.correct / state.attempts) * 100) + "%"
    : "—";
  el.level.textContent = String(state.levelIndex);
}

function setClassifyEnabled(enabled) {
  el.classify.classList.toggle("is-disabled", !enabled);
  el.classify.setAttribute("aria-hidden", String(!enabled));
}

function setPrompt(text) {
  el.prompt.textContent = text;
}

function announce(text) {
  canvas.setAttribute("aria-label", text);
}

let flashTimer = null;
function showFlash(text, good) {
  el.flash.textContent = text;
  el.flash.classList.remove("is-good", "is-bad");
  el.flash.classList.add("is-visible", good ? "is-good" : "is-bad");
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(hideFlash, good ? 800 : 1300);
}

function hideFlash() {
  el.flash.classList.remove("is-visible");
}

function startGame(fromLevel) {
  state.score = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.attempts = 0;
  state.correct = 0;
  el.startOverlay.hidden = true;
  el.summaryOverlay.hidden = true;
  state.paused = false;
  el.playpause.textContent = "Pause";
  loadLevel(fromLevel);
  canvas.focus();
}

function togglePause() {
  if (state.phase === PHASE.START || state.phase === PHASE.SUMMARY) return;
  state.paused = !state.paused;
  el.playpause.textContent = state.paused ? "Resume" : "Pause";
  setPrompt(state.paused ? "Paused." : "");
}

// ---------------------------------------------------------------------------
// Events.
// ---------------------------------------------------------------------------
el.choiceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (state.phase === PHASE.FROZEN) submitClassification(button.dataset.choice);
    else if (state.phase === PHASE.RESULT && state.calm) advanceAfterResult();
    canvas.focus();
  });
});

canvas.addEventListener("keydown", handleKey);

function handleKey(event) {
  const key = event.key;
  if (KEY_TO_GRADE[key]) {
    if (state.phase === PHASE.FROZEN) submitClassification(KEY_TO_GRADE[key]);
    else if (state.phase === PHASE.RESULT && state.calm) advanceAfterResult();
    event.preventDefault();
    return;
  }
  if (key === " ") {
    if (state.phase === PHASE.START) startGame(1);
    else if (state.phase === PHASE.RESULT && state.calm) advanceAfterResult();
    else togglePause();
    event.preventDefault();
    return;
  }
  if (key.toLowerCase() === "r") {
    startGame(1);
    event.preventDefault();
  }
}

canvas.addEventListener("pointerdown", () => {
  if (state.phase === PHASE.RESULT && state.calm) advanceAfterResult();
  canvas.focus();
});

el.playpause.addEventListener("click", togglePause);
el.restart.addEventListener("click", () => startGame(1));
el.startButton.addEventListener("click", () => startGame(1));
el.nextLevel.addEventListener("click", () => startGame(state.levelIndex + 1));
el.replayLevel.addEventListener("click", () => startGame(state.levelIndex));

el.calmToggle.addEventListener("click", () => {
  state.calm = !state.calm;
  el.calmToggle.setAttribute("aria-pressed", String(state.calm));
  setPrompt(
    state.calm ? "Calm mode: self-paced, no timer or scrolling." : "Timed mode."
  );
  if (state.phase === PHASE.SCROLL && state.calm) {
    state.camera = state.level.pois[state.targetIndex].x;
    enterFrozen();
  }
});

el.guidanceToggle.addEventListener("click", () => {
  const show = el.guidance.hidden;
  el.guidance.hidden = !show;
  el.guidanceToggle.textContent = show ? "Hide guidance" : "Show guidance";
  el.guidanceToggle.setAttribute("aria-expanded", String(show));
});

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
if (prefersReducedMotion) el.calmToggle.setAttribute("aria-pressed", "true");

state.level = makeLevel(1);
computeScale();
state.camera = state.level.pois[0].x - state.visibleUnits * 0.5;
setClassifyEnabled(false);

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);
resizeCanvas();
rafId = window.requestAnimationFrame(frame);
