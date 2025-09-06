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

function makeReference(kind, w = 12, h = 12) {
  const g = Array.from({ length: h }, () => Array(w).fill(T.WATER));

  const set = (r, c, t) => {
    if (r >= 0 && c >= 0 && r < h && c < w) g[r][c] = t;
  };

  const rect = (x0, y0, x1, y1, t) => {
    for (let r = y0; r <= y1; r++) {
      for (let c = x0; c <= x1; c++) {
        set(r, c, t);
      }
    }
  };

  const diamond = (cx, cy, rad, t) => {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (abs(r - cy) + abs(c - cx) <= rad) set(r, c, t);
      }
    }
  };

  const circle = (cx, cy, rad, t) => {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const dx = c - cx;
        const dy = r - cy;
        if (sqrt(dx * dx + dy * dy) <= rad) set(r, c, t);
      }
    }
  };

  const line = (x0, y0, x1, y1, t, thickness = 0) => {
    const steps = max(abs(x1 - x0), abs(y1 - y0)) * 6 + 1;

    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = x0 + (x1 - x0) * u;
      const y = y0 + (y1 - y0) * u;

      for (let rr = -thickness; rr <= thickness; rr++) {
        for (let cc = -thickness; cc <= thickness; cc++) {
          set(round(y) + rr, round(x) + cc, t);
        }
      }
    }
  };

  const borderWater = () => {
    rect(0, 0, w - 1, h - 1, T.WATER);
  };

  switch (kind) {
    case 0:
      borderWater();
      circle(5.5, 5.5, 5.0, T.SAND);
      circle(5.5, 5.5, 4.0, T.GRASS);
      circle(5.5, 5.5, 3.0, T.FOREST);
      circle(5.5, 5.5, 1.8, T.MOUNTAIN);
      set(5, 5, T.SNOW);
      break;

    case 1:
      rect(0, 0, w - 1, 2, T.WATER);
      rect(0, 3, w - 1, 4, T.SAND);
      rect(0, 5, w - 1, 7, T.GRASS);
      rect(0, 8, w - 1, 9, T.FOREST);
      rect(0, 10, w - 1, 11, T.MOUNTAIN);
      for (let c = 0; c < w; c += 3) set(2, c, T.WATER);
      for (let c = 1; c < w; c += 4) set(4, c, T.SAND);
      break;

    case 2:
      borderWater();
      rect(0, 0, w - 1, 1, T.WATER);
      rect(0, 10, w - 1, 11, T.WATER);
      line(1, 1, 10, 10, T.WATER, 1);
      line(2, 1, 9, 9, T.SAND, 0);
      line(1, 3, 10, 8, T.GRASS, 1);
      line(3, 1, 8, 10, T.FOREST, 0);
      set(5, 5, T.MOUNTAIN);
      set(6, 6, T.MOUNTAIN);
      break;

    case 3:
      borderWater();
      circle(5.5, 5.5, 5.0, T.WATER);
      circle(5.5, 5.5, 4.2, T.SAND);
      circle(5.5, 5.5, 3.3, T.GRASS);
      circle(5.5, 5.5, 2.4, T.FOREST);
      circle(5.5, 5.5, 1.5, T.MOUNTAIN);
      set(5, 5, T.SNOW);
      set(6, 6, T.SNOW);
      break;

    case 4:
      borderWater();
      circle(5.5, 5.5, 5.0, T.WATER);
      circle(5.5, 5.5, 4.1, T.SAND);
      circle(5.5, 5.5, 3.3, T.GRASS);
      circle(5.5, 5.5, 2.5, T.FOREST);
      circle(5.5, 5.5, 1.7, T.MOUNTAIN);
      set(5, 5, T.SNOW);
      break;

    case 5:
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const block = (floor(r / 2) + floor(c / 2)) % 6;
          g[r][c] =
            block === 0
              ? T.WATER
              : block === 1
                ? T.SAND
                : block === 2
                  ? T.GRASS
                  : block === 3
                    ? T.FOREST
                    : block === 4
                      ? T.MOUNTAIN
                      : T.SNOW;
        }
      }
      break;

    case 6:
      for (let r = 0; r < h; r++) {
        const band =
          r < 2
            ? T.WATER
            : r < 4
              ? T.SAND
              : r < 6
                ? T.GRASS
                : r < 8
                  ? T.FOREST
                  : r < 10
                    ? T.MOUNTAIN
                    : T.SNOW;

        for (let c = 0; c < w; c++) {
          g[r][c] = band;
        }
      }
      for (let c = 0; c < w; c += 2) {
        set(3, c, T.WATER);
        set(5, c, T.GRASS);
        set(7, c, T.FOREST);
        set(9, c, T.MOUNTAIN);
      }
      break;

    case 7:
      borderWater();
      rect(0, 0, w - 1, 3, T.WATER);
      line(6, 0, 6, 11, T.WATER, 1);
      line(6, 3, 3, 8, T.WATER, 0);
      line(6, 3, 9, 8, T.WATER, 0);
      line(6, 4, 4, 10, T.SAND, 0);
      line(6, 4, 8, 10, T.SAND, 0);
      line(6, 5, 5, 11, T.GRASS, 1);
      line(6, 5, 7, 11, T.GRASS, 1);
      set(6, 6, T.FOREST);
      set(5, 6, T.MOUNTAIN);
      set(7, 6, T.MOUNTAIN);
      break;

    case 8:
      rect(0, 0, w - 1, h - 1, T.GRASS);
      rect(4, 0, 7, h - 1, T.SAND);
      rect(5, 0, 6, h - 1, T.WATER);
      rect(3, 0, 3, h - 1, T.FOREST);
      rect(8, 0, 8, h - 1, T.FOREST);
      rect(2, 0, 2, h - 1, T.MOUNTAIN);
      rect(9, 0, 9, h - 1, T.MOUNTAIN);
      set(5, 5, T.SNOW);
      set(6, 6, T.SNOW);
      break;
  }

  return g;
}

function buildPaletteSets() {
  return [
    {
      name: "default",
      colors: [
        [0, 64, 128],
        [0, 128, 255],
        [0, 255, 0],
        [0, 77, 0],
        [204, 143, 143],
        [255, 255, 255],
      ],
    },
    {
      name: "forest",
      colors: [
        [52, 120, 220],
        [228, 210, 145],
        [96, 176, 88],
        [42, 102, 48],
        [122, 126, 116],
        [246, 248, 243],
      ],
    },
    {
      name: "redBrown",
      colors: [
        [62, 128, 214],
        [226, 192, 134],
        [176, 98, 62],
        [92, 46, 28],
        [132, 110, 96],
        [244, 236, 228],
      ],
    },
    {
      name: "darkLands",
      colors: [
        [34, 78, 142],
        [116, 96, 72],
        [78, 90, 68],
        [28, 30, 34],
        [84, 76, 78],
        [220, 220, 226],
      ],
    },
    {
      name: "blueNightmare",
      colors: [
        [18, 64, 128],
        [54, 72, 126],
        [30, 96, 170],
        [12, 18, 44],
        [76, 88, 132],
        [214, 226, 255],
      ],
    },
    {
      name: "nuclearAtomic",
      colors: [
        [54, 138, 224],
        [234, 244, 140],
        [170, 255, 58],
        [92, 176, 26],
        [140, 154, 92],
        [248, 255, 240],
      ],
    },
    {
      name: "uglyBeauty",
      colors: [
        [76, 116, 214],
        [220, 190, 152],
        [154, 136, 92],
        [126, 70, 118],
        [118, 124, 140],
        [242, 238, 246],
      ],
    },
    {
      name: "calm",
      colors: [
        [108, 176, 232],
        [232, 228, 204],
        [140, 198, 168],
        [96, 150, 140],
        [164, 172, 182],
        [248, 250, 252],
      ],
    },
    {
      name: "inferno",
      colors: [
        [233, 10, 10],
        [240, 208, 116],
        [232, 118, 42],
        [112, 34, 20],
        [116, 84, 72],
        [250, 240, 232],
      ],
    },
    {
      name: "toxic",
      colors: [
        [38, 118, 180],
        [210, 236, 120],
        [132, 232, 56],
        [52, 136, 40],
        [102, 126, 82],
        [236, 250, 228],
      ],
    },
    {
      name: "swamp",
      colors: [
        [44, 96, 132],
        [176, 170, 102],
        [96, 122, 74],
        [42, 66, 40],
        [88, 94, 90],
        [224, 228, 218],
      ],
    },
    {
      name: "volcanic",
      colors: [
        [24, 72, 140],
        [96, 78, 70],
        [76, 88, 74],
        [34, 34, 36],
        [108, 92, 88],
        [232, 232, 236],
      ],
    },
    {
      name: "ice",
      colors: [
        [86, 166, 238],
        [234, 242, 246],
        [172, 214, 226],
        [124, 168, 186],
        [186, 194, 204],
        [255, 255, 255],
      ],
    },
  ];
}

function keyPressed() {
  if (key === " ") {
    setDrawMode(!drawMode);
  } else if (key === "1") {
    curTerrain = T.WATER;
    document.getElementById("terrainSelect").value = "0";
  } else if (key === "2") {
    curTerrain = T.SAND;
    document.getElementById("terrainSelect").value = "1";
  } else if (key === "3") {
    curTerrain = T.GRASS;
    document.getElementById("terrainSelect").value = "2";
  } else if (key === "4") {
    curTerrain = T.FOREST;
    document.getElementById("terrainSelect").value = "3";
  } else if (key === "5") {
    curTerrain = T.MOUNTAIN;
    document.getElementById("terrainSelect").value = "4";
  } else if (key === "6") {
    curTerrain = T.SNOW;
    document.getElementById("terrainSelect").value = "5";
  } else if (key === "e" || key === "E") {
    curTerrain = -1;
    document.getElementById("terrainSelect").value = "-1";
  } else if (key === "g" || key === "G") {
    seed = floor(random(1e9));
    rebuildWorld();
  } else if (key === "c" || key === "C") {
    clearWorld();
  } else if (key === "s" || key === "S") {
    saveCanvas("procedural-map", "png");
  } else if (key === "[") {
    brushSize = max(1, brushSize - 1);
    document.getElementById("brushSize").value = brushSize;
    document.getElementById("brushSizeVal").textContent = brushSize;
  } else if (key === "]") {
    brushSize = min(20, brushSize + 1);
    document.getElementById("brushSize").value = brushSize;
    document.getElementById("brushSizeVal").textContent = brushSize;
  }
}

function mousePressed() {
  if (mouseX < mapW && mouseY < mapH && drawMode) {
    paintAt(mouseX, mouseY);
  }
}

function mouseDragged() {
  if (mouseX < mapW && mouseY < mapH && drawMode) {
    paintAt(mouseX, mouseY);
  }
}

function mouseWheel(event) {
  if (mouseX > mapW) return true;
  brushSize = constrain(brushSize + (event.delta > 0 ? -1 : 1), 1, 20);
  document.getElementById("brushSize").value = brushSize;
  document.getElementById("brushSizeVal").textContent = brushSize;
  return false;
}

function windowResized() {
  resizeCanvas(max(100, windowWidth - PANEL_W), windowHeight);
  rebuildWorld();
}
