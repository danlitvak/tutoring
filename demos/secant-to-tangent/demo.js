const canvas = document.querySelector("#graph");
const context = canvas.getContext("2d");
const functionButtons = document.querySelectorAll("[data-function]");
const fixedPointValue = document.querySelector("#fixed-point-value");
const gapValue = document.querySelector("#gap-value");
const deltaX = document.querySelector("#delta-x");
const deltaY = document.querySelector("#delta-y");
const secantSlope = document.querySelector("#secant-slope");
const tangentSlope = document.querySelector("#tangent-slope");
const slopeDifference = document.querySelector("#slope-difference");
const paperFunction = document.querySelector("#paper-function");
const guidance = document.querySelector("#guidance");
const guidanceToggle = document.querySelector("#guidance-toggle");
const closeGapButton = document.querySelector("#close-gap");
const switchSideButton = document.querySelector("#switch-side");
const resetButton = document.querySelector("#reset-demo");
const boardInstructions = document.querySelector("#board-instructions");

const minimumGap = 0.05;

const palette = {
  graphite: "#20242a",
  grid: "#dce4e6",
  gridStrong: "#9cabb3",
  blue: "#1769aa",
  orange: "#d96c24",
  green: "#2b7a55",
  white: "#ffffff",
  blueWash: "rgba(23, 105, 170, 0.14)",
  orangeWash: "rgba(217, 108, 36, 0.16)",
};

const functions = {
  quadratic: {
    label: "f(x) = x²",
    fn: (x) => x * x,
    derivative: (x) => 2 * x,
    xRange: [-3.5, 3.5],
    yRange: [-2, 10],
  },
  cubic: {
    label: "f(x) = x³ − x",
    fn: (x) => x * x * x - x,
    derivative: (x) => 3 * x * x - 1,
    xRange: [-2.6, 2.6],
    yRange: [-10, 10],
  },
  sine: {
    label: "f(x) = sin(x)",
    fn: (x) => Math.sin(x),
    derivative: (x) => Math.cos(x),
    xRange: [-4, 4],
    yRange: [-2.2, 2.2],
  },
};

const state = {
  functionKey: "quadratic",
  a: 1,
  h: 1,
  activePoint: "B",
  dragTarget: null,
  hoverTarget: null,
};

const format = (value) => {
  if (Math.abs(value) < 0.0005) return "0.000";
  return value.toFixed(3);
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getDefinition = () => functions[state.functionKey];

const getPointBounds = () => {
  const [xMin, xMax] = getDefinition().xRange;
  return [xMin + 0.35, xMax - 0.35];
};

const enforceGap = (a, b, preferredDirection = 1) => {
  const [minX, maxX] = getPointBounds();
  if (Math.abs(b - a) >= minimumGap) return clamp(b, minX, maxX);

  let candidate = a + preferredDirection * minimumGap;
  if (candidate < minX || candidate > maxX) {
    candidate = a - preferredDirection * minimumGap;
  }

  return clamp(candidate, minX, maxX);
};

const setFixedPoint = (nextA) => {
  const [minX, maxX] = getPointBounds();
  const previousB = state.a + state.h;
  state.a = clamp(nextA, minX, maxX);

  const preferredDirection = previousB >= state.a ? 1 : -1;
  const nextB = enforceGap(state.a, clamp(previousB, minX, maxX), preferredDirection);
  state.h = nextB - state.a;
};

const setMovingPoint = (requestedB) => {
  const [minX, maxX] = getPointBounds();
  const rawB = clamp(requestedB, minX, maxX);
  const preferredDirection = rawB === state.a ? Math.sign(state.h) || 1 : rawB > state.a ? 1 : -1;
  const nextB = enforceGap(state.a, rawB, preferredDirection);
  state.h = nextB - state.a;
};

const clampStateToFunction = () => {
  const [minX, maxX] = getPointBounds();
  const currentB = clamp(state.a + state.h, minX, maxX);
  state.a = clamp(state.a, minX, maxX);
  state.h = enforceGap(state.a, currentB, Math.sign(state.h) || 1) - state.a;
};

const getState = () => {
  const definition = getDefinition();
  const b = state.a + state.h;
  const yA = definition.fn(state.a);
  const yB = definition.fn(b);
  const secant = (yB - yA) / state.h;
  const tangent = definition.derivative(state.a);

  return {
    definition,
    a: state.a,
    b,
    h: state.h,
    yA,
    yB,
    secant,
    tangent,
  };
};

const getPlot = () => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const definition = getDefinition();
  const [xMin, xMax] = definition.xRange;
  const [yMin, yMax] = definition.yRange;
  const compact = width < 700;
  const padding = compact
    ? { top: 40, right: 24, bottom: 38, left: 42 }
    : { top: 38, right: 34, bottom: 42, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xToCanvas = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yToCanvas = (y) => padding.top + ((yMax - y) / (yMax - yMin)) * plotHeight;
  const canvasToX = (x) => xMin + ((x - padding.left) / plotWidth) * (xMax - xMin);

  return {
    width,
    height,
    xMin,
    xMax,
    yMin,
    yMax,
    padding,
    plotWidth,
    plotHeight,
    xToCanvas,
    yToCanvas,
    canvasToX,
  };
};

const getPointPositions = () => {
  const plot = getPlot();
  const current = getState();

  return {
    A: {
      x: plot.xToCanvas(current.a),
      y: plot.yToCanvas(current.yA),
    },
    B: {
      x: plot.xToCanvas(current.b),
      y: plot.yToCanvas(current.yB),
    },
  };
};

const resizeCanvas = () => {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  draw();
};

const drawPill = (text, x, y, color, align = "center") => {
  context.font = '700 12px "Cascadia Mono", Consolas, monospace';
  const metrics = context.measureText(text);
  const paddingX = 8;
  const width = metrics.width + paddingX * 2;
  const height = 22;
  const left = align === "left" ? x : align === "right" ? x - width : x - width / 2;
  const top = y - height / 2;

  context.fillStyle = color;
  context.beginPath();
  context.roundRect(left, top, width, height, 11);
  context.fill();

  context.fillStyle = palette.white;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, left + width / 2, y + 0.5);
};

const draw = () => {
  const plot = getPlot();
  if (!plot.width || !plot.height) return;

  const current = getState();
  const {
    width,
    height,
    xMin,
    xMax,
    yMin,
    yMax,
    padding,
    plotWidth,
    plotHeight,
    xToCanvas,
    yToCanvas,
  } = plot;

  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";

  const drawLine = (x1, y1, x2, y2, color, lineWidth = 1, dash = []) => {
    context.beginPath();
    context.setLineDash(dash);
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.setLineDash([]);
  };

  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += 1) {
    const canvasX = xToCanvas(x);
    drawLine(
      canvasX,
      padding.top,
      canvasX,
      height - padding.bottom,
      x === 0 ? palette.gridStrong : palette.grid,
      x === 0 ? 1.4 : 1
    );
  }

  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += 1) {
    const canvasY = yToCanvas(y);
    drawLine(
      padding.left,
      canvasY,
      width - padding.right,
      canvasY,
      y === 0 ? palette.gridStrong : palette.grid,
      y === 0 ? 1.4 : 1
    );
  }

  context.fillStyle = palette.graphite;
  context.font = '11px "Cascadia Mono", Consolas, monospace';
  context.textAlign = "center";
  context.textBaseline = "top";
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += 1) {
    if (x !== 0) context.fillText(String(x), xToCanvas(x), yToCanvas(0) + 7);
  }

  context.textAlign = "right";
  context.textBaseline = "middle";
  const yLabelStep = yMax - yMin > 12 ? 2 : 1;
  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += yLabelStep) {
    if (y !== 0) context.fillText(String(y), xToCanvas(0) - 8, yToCanvas(y));
  }

  context.save();
  context.beginPath();
  context.rect(padding.left, padding.top, plotWidth, plotHeight);
  context.clip();

  const tangentAt = (x) => current.yA + current.tangent * (x - current.a);
  drawLine(
    xToCanvas(xMin),
    yToCanvas(tangentAt(xMin)),
    xToCanvas(xMax),
    yToCanvas(tangentAt(xMax)),
    palette.green,
    2.5,
    [8, 7]
  );

  const secantAt = (x) => current.yA + current.secant * (x - current.a);
  drawLine(
    xToCanvas(xMin),
    yToCanvas(secantAt(xMin)),
    xToCanvas(xMax),
    yToCanvas(secantAt(xMax)),
    palette.orange,
    3
  );

  context.beginPath();
  context.strokeStyle = palette.blue;
  context.lineWidth = 4;
  const samples = Math.max(240, Math.round(plotWidth));
  for (let index = 0; index <= samples; index += 1) {
    const x = xMin + (index / samples) * (xMax - xMin);
    const y = current.definition.fn(x);
    const canvasX = xToCanvas(x);
    const canvasY = yToCanvas(y);
    if (index === 0) context.moveTo(canvasX, canvasY);
    else context.lineTo(canvasX, canvasY);
  }
  context.stroke();

  const points = getPointPositions();
  const aX = points.A.x;
  const aY = points.A.y;
  const bX = points.B.x;
  const bY = points.B.y;

  drawLine(aX, aY, bX, aY, palette.orange, 1.5, [4, 4]);
  drawLine(bX, aY, bX, bY, palette.orange, 1.5, [4, 4]);

  const drawPoint = (point, fill, label, helperText, helperAlign) => {
    const isActive = state.activePoint === label || state.dragTarget === label;
    const isHovering = state.hoverTarget === label;
    const haloRadius = isActive || isHovering ? 23 : 18;

    context.beginPath();
    context.fillStyle = label === "A" ? palette.blueWash : palette.orangeWash;
    context.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.fillStyle = palette.white;
    context.strokeStyle = fill;
    context.lineWidth = 4;
    context.arc(point.x, point.y, 10, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = fill;
    context.font = '800 12px "Cascadia Mono", Consolas, monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, point.x, point.y);

    drawPill(helperText, point.x + (helperAlign === "left" ? -16 : 16), point.y - 29, fill, helperAlign);
  };

  drawPoint(points.A, palette.blue, "A", "fixed A", "right");
  drawPoint(points.B, palette.orange, "B", "drag B", "left");
  context.restore();
};

const updateFunctionButtons = () => {
  functionButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.function === state.functionKey));
  });
};

const update = () => {
  clampStateToFunction();
  const current = getState();
  const deltaYValue = current.yB - current.yA;

  fixedPointValue.textContent = `a = ${current.a.toFixed(2)}`;
  gapValue.textContent = `Δx = ${format(current.h)}`;
  deltaX.textContent = format(current.h);
  deltaY.textContent = format(deltaYValue);
  secantSlope.value = format(current.secant);
  tangentSlope.textContent = format(current.tangent);
  slopeDifference.textContent = format(Math.abs(current.secant - current.tangent));
  paperFunction.textContent = current.definition.label;
  boardInstructions.textContent =
    state.activePoint === "A"
      ? "A is selected. Drag blue A, or use arrow keys, to move the fixed point."
      : "B is selected. Drag orange B toward blue A, or use arrow keys, to change Δx.";
  canvas.dataset.a = current.a.toFixed(2);
  canvas.dataset.b = current.b.toFixed(2);
  canvas.dataset.h = current.h.toFixed(2);
  canvas.setAttribute(
    "aria-label",
    `${current.definition.label}. Point A is at x equals ${current.a.toFixed(2)}. ` +
      `Point B is at x equals ${current.b.toFixed(2)}. ` +
      `The secant slope is ${format(current.secant)} and the tangent slope is ${format(current.tangent)}. ` +
      `Drag point B toward point A to make the secant line approach the tangent line.`
  );

  updateFunctionButtons();
  draw();
};

const getPointerPosition = (event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);

const hitTest = (position) => {
  const points = getPointPositions();
  const distances = {
    A: distance(position, points.A),
    B: distance(position, points.B),
  };
  const nearest = distances.A < distances.B ? "A" : "B";
  return distances[nearest] <= 34 ? nearest : null;
};

const movePointFromCanvasX = (target, canvasX) => {
  const plot = getPlot();
  const nextX = plot.canvasToX(canvasX);
  if (target === "A") setFixedPoint(nextX);
  else setMovingPoint(nextX);
};

canvas.addEventListener("pointerdown", (event) => {
  const position = getPointerPosition(event);
  const target = hitTest(position) || "B";
  state.dragTarget = target;
  state.activePoint = target;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
  movePointFromCanvasX(target, position.x);
  update();
});

canvas.addEventListener("pointermove", (event) => {
  const position = getPointerPosition(event);

  if (state.dragTarget) {
    movePointFromCanvasX(state.dragTarget, position.x);
    update();
    return;
  }

  state.hoverTarget = hitTest(position);
  canvas.style.cursor = state.hoverTarget ? "grab" : "crosshair";
  draw();
});

const stopDragging = (event) => {
  if (!state.dragTarget) return;
  state.dragTarget = null;
  state.hoverTarget = null;
  canvas.classList.remove("is-dragging");
  canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = "grab";
  update();
};

canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
canvas.addEventListener("pointerleave", () => {
  if (state.dragTarget) return;
  state.hoverTarget = null;
  canvas.style.cursor = "grab";
  draw();
});

canvas.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const step = event.shiftKey ? 0.25 : 0.05;

  if (key === "a" || key === "b") {
    state.activePoint = key.toUpperCase();
    update();
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    state.activePoint = state.activePoint === "A" ? "B" : "A";
    event.preventDefault();
    update();
    return;
  }

  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

  const direction = event.key === "ArrowRight" ? 1 : -1;
  if (state.activePoint === "A") setFixedPoint(state.a + direction * step);
  else setMovingPoint(state.a + state.h + direction * step);
  event.preventDefault();
  update();
});

functionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.functionKey = button.dataset.function;
    update();
  });
});

closeGapButton.addEventListener("click", () => {
  state.h = (Math.sign(state.h) || 1) * minimumGap;
  update();
});

switchSideButton.addEventListener("click", () => {
  state.h = -(Math.sign(state.h) || 1) * Math.max(Math.abs(state.h), minimumGap);
  update();
});

resetButton.addEventListener("click", () => {
  state.functionKey = "quadratic";
  state.a = 1;
  state.h = 1;
  state.activePoint = "B";
  update();
});

guidanceToggle.addEventListener("click", () => {
  const shouldShow = guidance.hidden;
  guidance.hidden = !shouldShow;
  guidanceToggle.textContent = shouldShow ? "Hide guidance" : "Show guidance";
  guidanceToggle.setAttribute("aria-expanded", String(shouldShow));
});

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);
update();
