const canvas = document.querySelector("#graph");
const context = canvas.getContext("2d");
const functionSelect = document.querySelector("#function-select");
const fixedPointInput = document.querySelector("#fixed-point");
const gapInput = document.querySelector("#gap");
const sideInputs = document.querySelectorAll('input[name="side"]');
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

const palette = {
  graphite: "#20242a",
  grid: "#dce4e6",
  gridStrong: "#9cabb3",
  blue: "#1769aa",
  orange: "#d96c24",
  green: "#2b7a55",
  white: "#ffffff",
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

const format = (value) => {
  if (Math.abs(value) < 0.0005) return "0.000";
  return value.toFixed(3);
};

const getState = () => {
  const definition = functions[functionSelect.value];
  const a = Number(fixedPointInput.value);
  const direction = Number(document.querySelector('input[name="side"]:checked').value);
  const h = direction * Number(gapInput.value);
  const b = a + h;
  const yA = definition.fn(a);
  const yB = definition.fn(b);
  const secant = (yB - yA) / h;
  const tangent = definition.derivative(a);

  return { definition, a, b, h, yA, yB, secant, tangent };
};

const resizeCanvas = () => {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  draw();
};

const draw = () => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  const state = getState();
  const [xMin, xMax] = state.definition.xRange;
  const [yMin, yMax] = state.definition.yRange;
  const padding = { top: 34, right: 28, bottom: 38, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xToCanvas = (x) => padding.left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yToCanvas = (y) => padding.top + ((yMax - y) / (yMax - yMin)) * plotHeight;

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

  const tangentAt = (x) => state.yA + state.tangent * (x - state.a);
  drawLine(
    xToCanvas(xMin),
    yToCanvas(tangentAt(xMin)),
    xToCanvas(xMax),
    yToCanvas(tangentAt(xMax)),
    palette.green,
    2.5,
    [8, 7]
  );

  const secantAt = (x) => state.yA + state.secant * (x - state.a);
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
    const y = state.definition.fn(x);
    const canvasX = xToCanvas(x);
    const canvasY = yToCanvas(y);
    if (index === 0) context.moveTo(canvasX, canvasY);
    else context.lineTo(canvasX, canvasY);
  }
  context.stroke();

  const aX = xToCanvas(state.a);
  const aY = yToCanvas(state.yA);
  const bX = xToCanvas(state.b);
  const bY = yToCanvas(state.yB);

  drawLine(aX, aY, bX, aY, palette.orange, 1.5, [4, 4]);
  drawLine(bX, aY, bX, bY, palette.orange, 1.5, [4, 4]);

  const drawPoint = (x, y, fill, label, labelOffset) => {
    context.beginPath();
    context.fillStyle = palette.white;
    context.strokeStyle = fill;
    context.lineWidth = 4;
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = palette.graphite;
    context.font = '700 12px "Cascadia Mono", Consolas, monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x, y + labelOffset);
  };

  drawPoint(aX, aY, palette.blue, "A", -20);
  drawPoint(bX, bY, palette.orange, "B", state.yB > state.yA ? -20 : 22);
  context.restore();
};

const update = () => {
  const state = getState();
  const deltaYValue = state.yB - state.yA;

  fixedPointValue.value = `a = ${state.a.toFixed(2)}`;
  gapValue.value = `Δx = ${format(state.h)}`;
  deltaX.textContent = format(state.h);
  deltaY.textContent = format(deltaYValue);
  secantSlope.value = format(state.secant);
  tangentSlope.textContent = format(state.tangent);
  slopeDifference.textContent = format(Math.abs(state.secant - state.tangent));
  paperFunction.textContent = state.definition.label;
  canvas.setAttribute(
    "aria-label",
    `${state.definition.label}. The fixed point is at x equals ${state.a.toFixed(2)}. ` +
      `The second point is at x equals ${state.b.toFixed(2)}. ` +
      `The secant slope is ${format(state.secant)} and the tangent slope is ${format(state.tangent)}.`
  );

  draw();
};

functionSelect.addEventListener("change", update);
fixedPointInput.addEventListener("input", update);
gapInput.addEventListener("input", update);
sideInputs.forEach((input) => input.addEventListener("change", update));
guidanceToggle.addEventListener("click", () => {
  const shouldHide = !guidance.hidden;
  guidance.hidden = shouldHide;
  guidanceToggle.textContent = shouldHide ? "Show guidance" : "Hide guidance";
  guidanceToggle.setAttribute("aria-pressed", String(shouldHide));
});

const resizeObserver = new ResizeObserver(resizeCanvas);
resizeObserver.observe(canvas);
update();
