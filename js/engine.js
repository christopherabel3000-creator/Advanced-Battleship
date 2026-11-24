// Advanced Battleship — game rules and computer opponent.
// No screen or keyboard code lives here, so new tactics can be added
// without touching the interface.
'use strict';

const ROWS = 'ABCDEFGHIJ'.split(''); // 10 rows, A at the top
const NUM_ROWS = 10;
const NUM_COLS = 14;                 // columns 1 to 14, left to right

const FLEET = [
  { id: 'carrier',    name: 'aircraft carrier',         size: 5 },
  { id: 'battleship', name: 'battleship',               size: 4 },
  { id: 'cruiser',    name: 'light missile cruiser',    size: 3 },
  { id: 'sub',        name: 'fast attack sub',          size: 3 },
  { id: 'specops',    name: 'special operations craft', size: 2 },
];

function coord(r, c) {
  return ROWS[r] + (c + 1);
}

// Accepts "C7", "c 7", "c-7", "J14". Returns {r, c} or null.
function parseCoord(text) {
  const m = /^\s*([a-j])\s*-?\s*(\d{1,2})\s*$/i.exec(text || '');
  if (!m) return null;
  const r = ROWS.indexOf(m[1].toUpperCase());
  const c = parseInt(m[2], 10) - 1;
  if (c < 0 || c >= NUM_COLS) return null;
  return { r, c };
}

function inBounds(r, c) {
  return r >= 0 && r < NUM_ROWS && c >= 0 && c < NUM_COLS;
}

class Board {
  constructor() {
    this.clear();
  }

  clear() {
    this.cells = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      const row = [];
      for (let c = 0; c < NUM_COLS; c++) row.push({ ship: null, shot: false });
      this.cells.push(row);
    }
    this.ships = {}; // id -> { def, cells: [[r,c]...], hits, horizontal }
  }

  // Horizontal ships run along a row (A1 to A5); vertical ships run down a column (A1 to E1).
  shipCells(size, r, c, horizontal) {
    const out = [];
    for (let i = 0; i < size; i++) out.push(horizontal ? [r, c + i] : [r + i, c]);
    return out;
  }

  canPlace(size, r, c, horizontal) {
    return this.shipCells(size, r, c, horizontal)
      .every(([rr, cc]) => inBounds(rr, cc) && !this.cells[rr][cc].ship);
  }

  place(def, r, c, horizontal) {
    if (!this.canPlace(def.size, r, c, horizontal)) return false;
    const cells = this.shipCells(def.size, r, c, horizontal);
    cells.forEach(([rr, cc]) => { this.cells[rr][cc].ship = def.id; });
    this.ships[def.id] = { def, cells, hits: 0, horizontal };
    return true;
  }

  remove(id) {
    const s = this.ships[id];
    if (!s) return;
    s.cells.forEach(([r, c]) => { this.cells[r][c].ship = null; });
    delete this.ships[id];
  }

  randomize() {
    this.clear();
    for (const def of FLEET) {
      let placed = false;
      while (!placed) {
        const h = Math.random() < 0.5;
        const r = Math.floor(Math.random() * NUM_ROWS);
        const c = Math.floor(Math.random() * NUM_COLS);
        placed = this.place(def, r, c, h);
      }
    }
  }

  allPlaced() {
    return FLEET.every(d => this.ships[d.id]);
  }

  // Returns { result: 'repeat' | 'miss' | 'hit' | 'sunk', ship? }
  fire(r, c) {
    const cell = this.cells[r][c];
    if (cell.shot) return { result: 'repeat' };
    cell.shot = true;
    if (!cell.ship) return { result: 'miss' };
    const s = this.ships[cell.ship];
    s.hits++;
    return { result: s.hits >= s.def.size ? 'sunk' : 'hit', ship: s };
  }

  isSunk(id) {
    const s = this.ships[id];
    return !!s && s.hits >= s.def.size;
  }

  allSunk() {
    return FLEET.every(d => this.isSunk(d.id));
  }

  shotsTaken() {
    let n = 0;
    for (const row of this.cells) for (const cell of row) if (cell.shot) n++;
    return n;
  }
}

// Basic computer opponent: hunts on a checkerboard pattern, then works
// around and along any hits until the ship sinks.
class ComputerAI {
  constructor() {
    this.tried = new Set();
    this.openHits = []; // hits on ships not yet sunk
  }

  key(r, c) { return r * NUM_COLS + c; }

  canTry(r, c) { return inBounds(r, c) && !this.tried.has(this.key(r, c)); }

  isOpenHit(r, c) { return this.openHits.some(([a, b]) => a === r && b === c); }

  nextShot() {
    let cands = [];

    // 1. Two or more hits in a line: extend the line at either end.
    for (const [r, c] of this.openHits) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (!this.isOpenHit(r + dr, c + dc) && !this.isOpenHit(r - dr, c - dc)) continue;
        let rr = r, cc = c;
        while (this.isOpenHit(rr + dr, cc + dc)) { rr += dr; cc += dc; }
        if (this.canTry(rr + dr, cc + dc)) cands.push([rr + dr, cc + dc]);
        rr = r; cc = c;
        while (this.isOpenHit(rr - dr, cc - dc)) { rr -= dr; cc -= dc; }
        if (this.canTry(rr - dr, cc - dc)) cands.push([rr - dr, cc - dc]);
      }
    }

    // 2. A lone hit: try the squares around it.
    if (!cands.length) {
      for (const [r, c] of this.openHits) {
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (this.canTry(r + dr, c + dc)) cands.push([r + dr, c + dc]);
        }
      }
    }

    // 3. Nothing to chase: hunt on a checkerboard (every ship covers at least one).
    if (!cands.length) {
      const all = [];
      for (let r = 0; r < NUM_ROWS; r++) {
        for (let c = 0; c < NUM_COLS; c++) {
          if (!this.canTry(r, c)) continue;
          all.push([r, c]);
          if ((r + c) % 2 === 0) cands.push([r, c]);
        }
      }
      if (!cands.length) cands = all;
    }

    const [r, c] = cands[Math.floor(Math.random() * cands.length)];
    this.tried.add(this.key(r, c));
    return { r, c };
  }

  report(r, c, res) {
    if (res.result === 'hit') {
      this.openHits.push([r, c]);
    } else if (res.result === 'sunk') {
      const sunk = new Set(res.ship.cells.map(([a, b]) => this.key(a, b)));
      this.openHits = this.openHits.filter(([a, b]) => !sunk.has(this.key(a, b)));
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ROWS, NUM_ROWS, NUM_COLS, FLEET, coord, parseCoord, inBounds, Board, ComputerAI };
}
