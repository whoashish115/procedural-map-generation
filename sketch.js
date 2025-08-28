const T = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  FOREST: 3,
  MOUNTAIN: 4,
  SNOW: 5,
};

const TERRAIN_NAMES = ["water", "sand", "grass", "forest", "mountain", "snow"];

const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const PANEL_W = 360;
const TERRAIN_COUNT = 6;
const DIR_COUNT = 8;

let cellSize = 6;
let brushSize = 2;
let brushType = "circle";
let stepsPerFrame = 700;
let drawMode = false;
let curTerrain = T.GRASS;

let cols = 0,
  rows = 0,
  mapW = 0,
  mapH = 0;
let world = [];
let locked = [];
let badness = [];
let todo = [];
let queued = [];
let rules = [];

let mapLayer;
let seed = 1;

let refIdx = 0;
let palIdx = 0;

let uiReady = false;
let refs = [];
let palettes = [];

let referenceButtons = [];
let paletteButtons = [];

function setup() {
  createCanvas(max(100, windowWidth - PANEL_W), windowHeight);
  pixelDensity(1);
  noSmooth();
  textFont("monospace");

  seed = floor(random(1e9));

  refs = buildReferenceSets();
  palettes = buildPaletteSets();

  bindUI();
  buildPresetGalleries();
  rebuildWorld();
  uiReady = true;
}

function draw() {
  if (!uiReady) return;

  const newCellSize = getInt("cellSize");
  const newBrush = getInt("brushSize");
  const newSolve = getInt("solveSpeed");
  const terrainVal = int(document.getElementById("terrainSelect").value);
  const brushTypeEl = document.getElementById("brushTypeSelect");
  const newBrushType = brushTypeEl ? brushTypeEl.value : brushType;

  if (newCellSize !== cellSize) {
    cellSize = newCellSize;
    rebuildWorld();
  }

  brushSize = newBrush;
  stepsPerFrame = newSolve;
  curTerrain = terrainVal;
  brushType = newBrushType;

  if (!drawMode) {
    solveStep(stepsPerFrame);
  }

  background(22);
  image(mapLayer, 0, 0);

  drawCursor();
  updateStats();
}

function getColors() {
  return palettes[palIdx].colors;
}

function setDrawMode(nextDrawMode) {
  drawMode = nextDrawMode;

  const btn = document.getElementById("toggleBtn");
  if (btn) {
    btn.textContent = drawMode ? "solve mode" : "draw mode";
  }

  if (!drawMode) {
    rescanAll();
  }
}

function bindUI() {
  const cellSizeEl = document.getElementById("cellSize");
  const brushSizeEl = document.getElementById("brushSize");
  const solveSpeedEl = document.getElementById("solveSpeed");

  const updateLabels = () => {
    document.getElementById("cellSizeVal").textContent = cellSizeEl.value;
    document.getElementById("brushSizeVal").textContent = brushSizeEl.value;
    document.getElementById("solveVal").textContent = solveSpeedEl.value;
  };

  cellSizeEl.addEventListener("input", updateLabels);
  brushSizeEl.addEventListener("input", updateLabels);
  solveSpeedEl.addEventListener("input", updateLabels);
  updateLabels();

  const brushTypeHost = document.getElementById("brushTypeHost");
  if (brushTypeHost && !document.getElementById("brushTypeSelect")) {
    const label = document.createElement("label");
    label.textContent = "brush type";

    const select = document.createElement("select");
    select.id = "brushTypeSelect";
    select.innerHTML = `
      <option value="circle">circle</option>
      <option value="square">square</option>
      <option value="diamond">diamond</option>
      <option value="cross">cross</option>
      <option value="plus">plus</option>
      <option value="ring">ring</option>
      <option value="lineH">line horizontal</option>
      <option value="lineV">line vertical</option>
      <option value="scatter">scatter</option>
      <option value="checker">checker</option>
    `;
    select.value = brushType;
    brushTypeHost.appendChild(label);
    brushTypeHost.appendChild(select);
  }

  document.getElementById("toggleBtn").onclick = () => {
    setDrawMode(!drawMode);
  };

  document.getElementById("randomBtn").onclick = () => {
    seed = floor(random(1e9));
    rebuildWorld();
  };

  document.getElementById("clearBtn").onclick = () => {
    clearWorld();
  };

  document.getElementById("savePNG").onclick = () => {
    saveCanvas("map", "png");
  };

  document.getElementById("saveJPG").onclick = () => {
    saveCanvas("map", "jpg");
  };

  document.getElementById("saveSVG").onclick = () => {
    saveSVG();
  };
}

function getInt(id) {
  return int(document.getElementById(id).value);
}

function rebuildWorld() {
  mapW = max(100, windowWidth - PANEL_W);
  mapH = windowHeight;

  cols = max(1, floor(mapW / cellSize));
  rows = max(1, floor(mapH / cellSize));

  mapW = cols * cellSize;
  mapH = rows * cellSize;

  resizeCanvas(mapW, mapH);

  mapLayer = createGraphics(mapW, mapH);
  mapLayer.pixelDensity(1);
  mapLayer.noSmooth();

  rules = buildRules(refs[refIdx].grid);

  world = Array.from({ length: rows }, () => Array(cols).fill(0));
  locked = Array.from({ length: rows }, () => Array(cols).fill(false));
  badness = Array.from({ length: rows }, () => Array(cols).fill(0));
  queued = Array.from({ length: rows }, () => Array(cols).fill(false));
  todo = [];

  randomSeed(seed);
  noiseSeed(seed);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      world[r][c] = floor(random(TERRAIN_COUNT));
      locked[r][c] = false;
      badness[r][c] = 0;
      redrawCell(r, c);
    }
  }

  rescanAll();
  refreshGalleryThumbs();
}

function buildRules(ref) {
  const R = Array.from({ length: TERRAIN_COUNT }, () =>
    Array.from({ length: DIR_COUNT }, () => Array(TERRAIN_COUNT).fill(false)),
  );

  for (let r = 0; r < ref.length; r++) {
    for (let c = 0; c < ref[0].length; c++) {
      const t = ref[r][c];
      for (let d = 0; d < DIR_COUNT; d++) {
        const nr = r + DIRS[d][0];
        const nc = c + DIRS[d][1];
        if (nr < 0 || nc < 0 || nr >= ref.length || nc >= ref[0].length)
          continue;
        R[t][d][ref[nr][nc]] = true;
      }
    }
  }

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    for (let d = 0; d < DIR_COUNT; d++) {
      if (!R[t][d].some(Boolean)) {
        R[t][d][t] = true;
      }
    }
  }

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    for (let d = 0; d < DIR_COUNT; d++) {
      for (let nt = 0; nt < TERRAIN_COUNT; nt++) {
        if (R[t][d][nt]) {
          const od = d ^ 7;
          R[nt][od][t] = true;
        }
      }
    }
  }

  return R;
}

function solveStep(steps) {
  let count = 0;

  while (count < steps) {
    if (todo.length === 0) {
      const anyBad = rescanAll();
      if (!anyBad) break;
    }

    let bestIndex = -1;
    let bestConflict = -1;

    for (let i = 0; i < todo.length; i++) {
      const node = todo[i];
      if (queued[node.r][node.c] !== true) continue;

     const sc = badness[node.r][node.c];
      if (sc > bestConflict) {
        bestConflict = sc;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      todo = [];
      continue;
    }

    const node = todo.splice(bestIndex, 1)[0];
    queued[node.r][node.c] = false;

    const r = node.r;
    const c = node.c;

    if (locked[r][c]) {
      badness[r][c] = 0;
      count++;
      continue;
    }

    const current = world[r][c];
    const choice = pickTerrain(r, c, current);

    if (choice.terrain !== current) {
      world[r][c] = choice.terrain;
      redrawCell(r, c);
    }

    badness[r][c] = choice.score;
    dirtyAround(r, c);
    count++;
  }
}

function pickTerrain(r, c, wasT) {
  let bestScore = Infinity;
  let ties = [];

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const s = scoreOf(r, c, t);

    if (s < bestScore - 1e-9) {
      bestScore = s;
      ties = [t];
    } else if (abs(s - bestScore) <= 1e-9) {
      ties.push(t);
    }
  }

  if (ties.length === 0) {
    return { terrain: wasT, score: scoreOf(r, c, wasT) };
  }

  const picked = random(ties);
  return { terrain: picked, score: bestScore };
}

function scoreOf(r, c, t) {
  let score = 0;
  let same = 0;
  let total = 0;

  for (let d = 0; d < DIR_COUNT; d++) {
    const nr = r + DIRS[d][0];
    const nc = c + DIRS[d][1];
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;

    total++;
    const nt = world[nr][nc];
    if (nt === t) same++;
    if (!rules[t][d][nt]) score += 1;
  }

  if (total > 0) {
    score += (1 - same / total) * 0.15;
  }

  return score;
}

function redrawCell(r, c) {
  const x = c * cellSize;
  const y = r * cellSize;
  const t = world[r][c];
  const col = getColors()[t];

  mapLayer.noStroke();
  mapLayer.fill(col[0], col[1], col[2]);
  mapLayer.rect(x, y, cellSize, cellSize);

  if (locked[r][c]) {
    mapLayer.stroke(0, 0, 0, 30);
    mapLayer.noFill();
    mapLayer.rect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    mapLayer.noStroke();
  }
}

function redrawEverything() {
  if (!mapLayer) return;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      redrawCell(r, c);
    }
  }
}

function enqueue(r, c) {
  if (r < 0 || c < 0 || r >= rows || c >= cols) return;
  if (queued[r][c]) return;
  queued[r][c] = true;
  todo.push({ r, c });
}

function dirtyAround(r, c) {
  enqueue(r, c);
  for (let d = 0; d < DIR_COUNT; d++) {
    enqueue(r + DIRS[d][0], c + DIRS[d][1]);
  }
}

function brushCells(type, size) {
  const out = [];

  for (let rr = -size; rr <= size; rr++) {
    for (let cc = -size; cc <= size; cc++) {
      const ar = abs(rr);
      const ac = abs(cc);

      let keep = false;

      if (type === "circle") {
        keep = rr * rr + cc * cc <= size * size;
      } else if (type === "square") {
        keep = true;
      } else if (type === "diamond") {
        keep = ar + ac <= size;
      } else if (type === "cross") {
        keep = rr === 0 || cc === 0;
      } else if (type === "plus") {
        keep =
          rr === 0 ||
          cc === 0 ||
          (ar + ac <= max(1, size - 1) && (ar === 0 || ac === 0));
      } else if (type === "ring") {
        const d2 = rr * rr + cc * cc;
        keep = d2 <= size * size && d2 >= max(0, (size - 1) * (size - 1));
      } else if (type === "lineH") {
        keep = rr === 0;
      } else if (type === "lineV") {
        keep = cc === 0;
      } else if (type === "scatter") {
        keep = random() < 0.45 && rr * rr + cc * cc <= size * size;
      } else if (type === "checker") {
        keep = ((rr + cc) & 1) === 0 && rr * rr + cc * cc <= size * size;
      } else {
        keep = rr * rr + cc * cc <= size * size;
      }

      if (keep) out.push([rr, cc]);
    }
  }

  return out;
}

function paintAt(mx, my) {
  if (mx < 0 || my < 0 || mx >= mapW || my >= mapH) return;

  const gx = floor(mx / cellSize);
  const gy = floor(my / cellSize);
  const cells = brushCells(brushType, brushSize);

  for (const [rr, cc] of cells) {
    const r = gy + rr;
    const c = gx + cc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;

    if (curTerrain === -1) {
      locked[r][c] = false;
      world[r][c] = floor(random(TERRAIN_COUNT));
    } else {
      locked[r][c] = true;
      world[r][c] = curTerrain;
    }

    redrawCell(r, c);
    dirtyAround(r, c);
  }
}

function drawCursor() {
  if (mouseX < 0 || mouseY < 0 || mouseX >= mapW || mouseY >= mapH) return;

  const gx = floor(mouseX / cellSize) * cellSize;
  const gy = floor(mouseY / cellSize) * cellSize;

  noFill();
  stroke(255, 255, 255, 140);
  strokeWeight(1);
  rect(gx + 0.5, gy + 0.5, cellSize, cellSize);

  if (!drawMode) return;

  const cells = brushCells(brushType, brushSize);
  stroke(255, 255, 255, 55);

  for (const [rr, cc] of cells) {
    const r = floor(mouseY / cellSize) + rr;
    const c = floor(mouseX / cellSize) + cc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
    rect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize, cellSize);
  }
}

function updateStats() {
  const stats = document.getElementById("stats");
  if (!stats) return;

  stats.textContent =
    "mode: " +
    (drawMode ? "drawing" : "solving") +
    "\n" +
    "reference: " +
    refs[refIdx].name +
    "\n" +
    "palette: " +
    palettes[palIdx].name +
    "\n" +
    "terrain: " +
    (curTerrain === -1 ? "erase" : TERRAIN_NAMES[curTerrain]) +
    "\n" +
    "brush: " +
    brushType +
    "\n" +
    "cell size: " +
    cellSize +
    "\n" +
    "brush size: " +
    brushSize +
    "\n" +
    "solve/frame: " +
    stepsPerFrame +
    "\n" +
    "seed: " +
    seed +
    "\n" +
    "map: " +
    cols +
    " x " +
    rows;
}

function clearWorld() {
  todo = [];
  queued = Array.from({ length: rows }, () => Array(cols).fill(false));

  randomSeed(seed);
  noiseSeed(seed);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      world[r][c] = floor(random(TERRAIN_COUNT));
      locked[r][c] = false;
      badness[r][c] = 0;
      redrawCell(r, c);
    }
  }

  rescanAll();
}

function rescanAll() {
  todo = [];
  let anyBad = false;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      queued[r][c] = false;
      if (!locked[r][c]) {
        const sc = scoreOf(r, c, world[r][c]);
        badness[r][c] = sc;
        if (sc > 0) {
          enqueue(r, c);
          anyBad = true;
        }
      } else {
        badness[r][c] = 0;
      }
    }
  }

  return anyBad;
}

function setActiveReference(idx) {
  refIdx = idx;
  rules = buildRules(refs[refIdx].grid);
  rescanAll();
  update_preset_active();
}

function setActivePalette(idx) {
  palIdx = idx;
  redrawEverything();
  refreshGalleryThumbs();
  update_preset_active();
}

function update_preset_active() {
  referenceButtons.forEach((b, i) =>
    b.classList.toggle("active", i === refIdx),
  );
  paletteButtons.forEach((b, i) =>
    b.classList.toggle("active", i === palIdx),
  );
}

function buildPresetGalleries() {
  const referenceGrid = document.getElementById("referenceGrid");
  const paletteGrid = document.getElementById("paletteGrid");

  referenceGrid.innerHTML = "";
  paletteGrid.innerHTML = "";
  referenceButtons = [];
  paletteButtons = [];

  refs.forEach((ref, idx) => {
    const btn = document.createElement("button");
    btn.className = "presetBtn";
    btn.title = ref.name;

    const canvas = document.createElement("canvas");
    canvas.width = 72;
    canvas.height = 72;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = ref.name;

    btn.appendChild(canvas);
    btn.appendChild(title);

    btn.addEventListener("click", () => {
      setActiveReference(idx);
    });

    referenceGrid.appendChild(btn);
    referenceButtons.push(btn);
  });

  palettes.forEach((pal, idx) => {
    const btn = document.createElement("button");
    btn.className = "presetBtn";
    btn.title = pal.name;

    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 28;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = pal.name;

    btn.appendChild(canvas);
    btn.appendChild(title);

    btn.addEventListener("click", () => {
      setActivePalette(idx);
    });

    paletteGrid.appendChild(btn);
    paletteButtons.push(btn);
  });

  update_preset_active();
  refreshGalleryThumbs();
}

function refreshGalleryThumbs() {
  const currentColors = getColors();

  referenceButtons.forEach((btn, idx) => {
    const canvas = btn.querySelector("canvas");
    drawRefrenceThumb(canvas, refs[idx].grid, currentColors);
  });

  paletteButtons.forEach((btn, idx) => {
    const canvas = btn.querySelector("canvas");
    drawPaletteThumb(canvas, palettes[idx].colors);
  });
}

function drawRefrenceThumb(canvasEl, grid, paletteColors) {
  const ctx = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;
  const rowsN = grid.length;
  const colsN = grid[0].length;
  const cw = w / colsN;
  const ch = h / rowsN;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < colsN; c++) {
      const t = grid[r][c];
      const col = paletteColors[t];
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function drawPaletteThumb(canvasEl, colors) {
  const ctx = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;
  const sw = w / colors.length;

  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < colors.length; i++) {
    const col = colors[i];
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.fillRect(i * sw, 0, sw + 0.5, h);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function buildReferenceSets() {
  return [
    { name: "island", grid: makeReference(0) },
    { name: "coast", grid: makeReference(1) },
    { name: "river", grid: makeReference(2) },
    { name: "ring", grid: makeReference(3) },
    { name: "volcano", grid: makeReference(4) },
    { name: "patchwork", grid: makeReference(5) },
    { name: "stripes", grid: makeReference(6) },
    { name: "delta", grid: makeReference(7) },
    { name: "canyon", grid: makeReference(8) },
  ];
}
