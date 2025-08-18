const T = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  FOREST: 3,
  MOUNTAIN: 4,
  SNOW: 5,
};

const TERRAIN_NAMES = ["water", "sand", "grass", "forest", "mountain", "snow"];

let cellSize = 10;
let cols = 0, rows = 0;
let world = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  cols = floor(width / cellSize);
  rows = floor(height / cellSize);
  world = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      world[r][c] = floor(random(6));
    }
  }
}

function draw() {
  background(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let col = [0,0,0];
      switch(world[r][c]) {
        case T.WATER: col = [0, 64, 128]; break;
        case T.SAND: col = [0, 128, 255]; break;
        case T.GRASS: col = [0, 255, 0]; break;
        case T.FOREST: col = [0, 77, 0]; break;
        case T.MOUNTAIN: col = [204, 143, 143]; break;
        case T.SNOW: col = [255, 255, 255]; break;
      }
      fill(col[0], col[1], col[2]);
      noStroke();
      rect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}