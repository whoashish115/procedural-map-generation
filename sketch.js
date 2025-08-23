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