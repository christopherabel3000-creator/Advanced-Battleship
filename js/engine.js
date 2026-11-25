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

// Offsets from the chosen square. Rows change with the first number, columns with the second.
// "h" (horizontal) runs along a row, like E3 E4 E5; "v" (vertical) runs down a column, like D4 E4 F4.
const PATTERNS = {
  x:      [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]],
  plus:   [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
  square: [-1, 0, 1].flatMap(a => [-1, 0, 1].map(b => [a, b])),
  h:      [[0, -1], [0, 0], [0, 1]],
  v:      [[-1, 0], [0, 0], [1, 0]],
};

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

function patternCells(name, r, c) {
  return PATTERNS[name].map(([dr, dc]) => [r + dr, c + dc]).filter(([a, b]) => inBounds(a, b));
}

function sameCell(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
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

  // A square holding part of a ship that hasn't sunk yet.
  afloatAt(r, c) {
    const id = this.cells[r][c].ship;
    return !!id && !this.isSunk(id);
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

// One player: their fleet, weapons, squadrons, and what they've learned about the enemy grid.
class Side {
  constructor(advanced) {
    this.advanced = advanced;
    this.board = new Board();
    this.ammo = { tomahawk: 1, harpoon: 2, torpedo: 2 };
    // status: 'carrier' (waiting on deck), 'airborne', or 'destroyed'
    this.squadrons = [1, 2].map(n => ({ n, cell: null, status: 'carrier', pos: null, struck: false }));
    // What this side knows about the enemy grid beyond its shots: 'unknown', 'spotted' or 'clear'.
    this.knowledge = Array.from({ length: NUM_ROWS }, () => Array(NUM_COLS).fill('unknown'));
  }

  squadronOnDeckAt(r, c) {
    return this.squadrons.find(s => s.status === 'carrier' && sameCell(s.cell, [r, c]));
  }

  clearSquadrons() {
    this.squadrons.forEach(s => { s.cell = null; });
  }

  placeSquadron(n, r, c) {
    if (this.board.cells[r][c].ship !== 'carrier') return false;
    if (this.squadrons.some(s => s.n !== n && sameCell(s.cell, [r, c]))) return false;
    this.squadrons[n - 1].cell = [r, c];
    return true;
  }

  randomSquadrons() {
    const cells = this.board.ships.carrier.cells.slice().sort(() => Math.random() - 0.5);
    this.squadrons[0].cell = cells[0];
    this.squadrons[1].cell = cells[1];
  }

  squadronsPlaced() {
    return this.squadrons.every(s => s.cell);
  }

  ready() {
    return this.board.allPlaced() && (!this.advanced || this.squadronsPlaced());
  }

  can(kind) {
    if (kind === 'shot') return true;
    if (!this.advanced) return false;
    const b = this.board;
    switch (kind) {
      case 'sq1': return this.squadrons[0].status !== 'destroyed';
      case 'sq2': return this.squadrons[1].status !== 'destroyed';
      case 'tomahawk': return this.ammo.tomahawk > 0 && !b.isSunk('battleship');
      case 'harpoon': return this.ammo.harpoon > 0 && !b.isSunk('cruiser');
      case 'torpedo': return this.ammo.torpedo > 0 && !b.isSunk('sub');
      case 'sonar': return !b.isSunk('sub');
      case 'aa': return true;
      default: return false;
    }
  }
}

// The whole match. Side 0 is the human, side 1 the computer.
// act() takes one action and returns an event describing exactly what happened,
// or { error } if the action isn't allowed.
class Game {
  constructor(advanced, plusOne = false) {
    this.plusOne = plusOne;   // Target plus 1: a hit earns another turn
    this.sides = [new Side(advanced), new Side(advanced)];
    this.setAdvanced(advanced);
    this.pendingStrike = null; // { side, n, cells } after a squadron's first sighting
    this.winner = null;
  }

  setAdvanced(v) {
    this.advanced = v;
    this.sides.forEach(s => { s.advanced = v; });
  }

  opp(i) { return this.sides[1 - i]; }

  // Fire on one square of side defIdx's grid.
  hit(defIdx, r, c) {
    const def = this.sides[defIdx];
    const res = def.board.fire(r, c);
    const out = { r, c, result: res.result, ship: res.ship };
    if (res.ship && res.ship.def.id === 'carrier') {
      const sq = def.squadronOnDeckAt(r, c);
      if (sq) { sq.status = 'destroyed'; out.squadronLost = sq.n; }
    }
    return out;
  }

  hitArea(i, cells) {
    const them = this.opp(i);
    return cells.filter(([r, c]) => !them.board.cells[r][c].shot).map(([r, c]) => this.hit(1 - i, r, c));
  }

  act(i, a) {
    if (this.winner !== null) return { error: 'The game is over.' };
    const me = this.sides[i];
    const them = this.opp(i);
    const ps = this.pendingStrike;
    if (ps && ps.side === i && a.type !== 'strike') {
      return { error: `Squadron ${ps.n} must strike first. Choose ${ps.cells.length > 1 ? 'one of the spotted squares' : 'the spotted square'}: ${ps.cells.map(([r, c]) => coord(r, c)).join(', ')}.` };
    }
    const ev = { side: i, type: a.type, r: a.r, c: a.c, results: [] };
    const tb = them.board;

    switch (a.type) {
      case 'shot': {
        if (tb.cells[a.r][a.c].shot) return { error: `Already fired at ${coord(a.r, a.c)}.` };
        ev.results.push(this.hit(1 - i, a.r, a.c));
        break;
      }

      case 'search': {
        if (!me.can('sq' + a.n)) return { error: `Attack squadron ${a.n} is gone.` };
        const sq = me.squadrons[a.n - 1];
        ev.n = a.n;
        ev.pattern = a.pattern;
        ev.launched = sq.status === 'carrier';
        sq.status = 'airborne';
        sq.pos = [a.r, a.c];
        const cells = patternCells(a.pattern, a.r, a.c);
        ev.spotted = cells.filter(([r, c]) => tb.afloatAt(r, c));
        for (const [r, c] of cells) {
          if (!tb.cells[r][c].ship) me.knowledge[r][c] = 'clear';
          else if (tb.afloatAt(r, c)) me.knowledge[r][c] = 'spotted';
        }
        const strikeCells = ev.spotted.filter(([r, c]) => !tb.cells[r][c].shot);
        if (!sq.struck && strikeCells.length) {
          this.pendingStrike = { side: i, n: a.n, cells: strikeCells };
          ev.strike = true;
        }
        break;
      }

      case 'strike': {
        if (!ps || ps.side !== i) return { error: 'No strike is ready.' };
        if (!ps.cells.some(cell => sameCell(cell, [a.r, a.c]))) {
          return { error: `Choose one of the spotted squares: ${ps.cells.map(([r, c]) => coord(r, c)).join(', ')}.` };
        }
        me.squadrons[ps.n - 1].struck = true;
        this.pendingStrike = null;
        ev.n = ps.n;
        ev.results.push(this.hit(1 - i, a.r, a.c));
        break;
      }

      case 'tomahawk': {
        if (!me.can('tomahawk')) return { error: 'No Tomahawk available.' };
        me.ammo.tomahawk--;
        ev.results = this.hitArea(i, patternCells('square', a.r, a.c));
        break;
      }

      case 'harpoon': {
        if (!me.can('harpoon')) return { error: 'No harpoons available.' };
        me.ammo.harpoon--;
        ev.dir = a.dir;
        ev.results = this.hitArea(i, patternCells(a.dir, a.r, a.c));
        break;
      }

      case 'torpedo': {
        if (!me.can('torpedo')) return { error: 'No torpedoes available.' };
        me.ammo.torpedo--;
        ev.dir = a.dir;
        // Horizontal runs along the chosen row from column 1; vertical runs down the chosen column from row A.
        const path = [];
        if (a.dir === 'h') for (let c = 0; c < NUM_COLS; c++) path.push([a.r, c]);
        else for (let r = 0; r < NUM_ROWS; r++) path.push([r, a.c]);
        ev.start = path[0];
        for (const [r, c] of path) {
          if (tb.afloatAt(r, c)) {
            ev.contact = [r, c];
            if (tb.cells[r][c].shot) ev.alreadyDamaged = true;
            else ev.results.push(this.hit(1 - i, r, c));
            break;
          }
          if (!tb.cells[r][c].ship) me.knowledge[r][c] = 'clear';
        }
        break;
      }

      case 'sonar': {
        if (!me.can('sonar')) return { error: 'Sonar is gone with the sub.' };
        const cells = patternCells('square', a.r, a.c);
        ev.detected = cells.some(([r, c]) => tb.afloatAt(r, c));
        if (!ev.detected) {
          for (const [r, c] of cells) if (!tb.cells[r][c].ship) me.knowledge[r][c] = 'clear';
        }
        break;
      }

      case 'aa': {
        if (!me.can('aa')) return { error: 'No antiaircraft battery.' };
        // Fired over your own waters, where enemy squadrons fly.
        ev.downed = [];
        for (const sq of them.squadrons) {
          if (sq.status === 'airborne' && sameCell(sq.pos, [a.r, a.c])) {
            sq.status = 'destroyed';
            ev.downed.push(sq.n);
          }
        }
        break;
      }

      default:
        return { error: 'Unknown action.' };
    }

    if (tb.allSunk()) this.winner = i;
    ev.winner = this.winner;
    // Target plus 1: new damage to a ship, or downing a squadron, earns another turn.
    // Searches and sonar never do; a search that spots a ship leads to its strike instead.
    const hitSomething = ev.results.some(x => x.result === 'hit' || x.result === 'sunk') ||
      (ev.type === 'aa' && ev.downed.length > 0);
    ev.again = this.plusOne && hitSomething && this.winner === null;
    return ev;
  }
}

// Computer opponent. It only reads what a player would know: its own fleet,
// the results of its shots, which ships are sunk, and its own search findings.
class ComputerAI {
  constructor(game, me) {
    this.g = game;
    this.me = me;
    this.contacts = [];  // sonar centers where a ship was detected
    this.enemySq = {};   // enemy squadron number -> { cands: possible positions }
  }

  get side() { return this.g.sides[this.me]; }
  get foeBoard() { return this.g.opp(this.me).board; }

  isShot(r, c) { return this.foeBoard.cells[r][c].shot; }
  isOpenHit(r, c) {
    if (!inBounds(r, c)) return false;
    const cell = this.foeBoard.cells[r][c];
    return cell.shot && !!cell.ship && !this.foeBoard.isSunk(cell.ship);
  }
  huntable(r, c) {
    return inBounds(r, c) && !this.isShot(r, c) && this.side.knowledge[r][c] !== 'clear';
  }

  targets() {
    const hits = [];
    const spotted = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      for (let c = 0; c < NUM_COLS; c++) {
        if (this.isOpenHit(r, c)) hits.push([r, c]);
        else if (!this.isShot(r, c) && this.side.knowledge[r][c] === 'spotted') spotted.push([r, c]);
      }
    }
    const line = [];
    for (const [r, c] of hits) {
      for (const [dr, dc, dir] of [[0, 1, 'h'], [1, 0, 'v']]) {
        if (!this.isOpenHit(r + dr, c + dc) && !this.isOpenHit(r - dr, c - dc)) continue;
        let rr = r, cc = c;
        while (this.isOpenHit(rr + dr, cc + dc)) { rr += dr; cc += dc; }
        if (this.huntable(rr + dr, cc + dc)) line.push({ cell: [rr + dr, cc + dc], dir });
        rr = r; cc = c;
        while (this.isOpenHit(rr - dr, cc - dc)) { rr -= dr; cc -= dc; }
        if (this.huntable(rr - dr, cc - dc)) line.push({ cell: [rr - dr, cc - dc], dir });
      }
    }
    const nbrs = [];
    for (const [r, c] of hits) {
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (this.huntable(r + dr, c + dc)) nbrs.push([r + dr, c + dc]);
      }
    }
    return { spotted, line, nbrs };
  }

  bestCenter(pattern) {
    let best = [], bestScore = -1;
    for (let r = 0; r < NUM_ROWS; r++) {
      for (let c = 0; c < NUM_COLS; c++) {
        const score = patternCells(pattern, r, c)
          .filter(([a, b]) => this.huntable(a, b) && this.side.knowledge[a][b] === 'unknown').length;
        if (score > bestScore) { bestScore = score; best = [[r, c]]; }
        else if (score === bestScore) best.push([r, c]);
      }
    }
    return pick(best);
  }

  huntShot() {
    const all = [], parity = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      for (let c = 0; c < NUM_COLS; c++) {
        if (!this.huntable(r, c)) continue;
        all.push([r, c]);
        if ((r + c) % 2 === 0) parity.push([r, c]);
      }
    }
    let list = parity.length ? parity : all;
    if (!list.length) { // only "clear"-marked squares remain unshot; shouldn't happen, but stay safe
      for (let r = 0; r < NUM_ROWS; r++) for (let c = 0; c < NUM_COLS; c++) if (!this.isShot(r, c)) list.push([r, c]);
    }
    const [r, c] = pick(list);
    return { type: 'shot', r, c };
  }

  choose() {
    const s = this.side;
    const adv = this.g.advanced;
    const shot = ([r, c]) => ({ type: 'shot', r, c });

    // Antiaircraft: if an enemy squadron's position has been narrowed down, try to bring it down.
    if (adv) {
      for (const n of [1, 2]) {
        const info = this.enemySq[n];
        if (info && info.cands.length && info.cands.length <= 4 && Math.random() < 0.5) {
          const [r, c] = pick(info.cands);
          info.cands = info.cands.filter(x => !sameCell(x, [r, c]));
          return { type: 'aa', r, c };
        }
      }
    }

    const t = this.targets();
    if (t.spotted.length) return shot(pick(t.spotted));
    if (t.line.length) {
      const l = pick(t.line);
      if (adv && s.can('harpoon') && Math.random() < 0.5) return { type: 'harpoon', dir: l.dir, r: l.cell[0], c: l.cell[1] };
      return shot(l.cell);
    }
    if (t.nbrs.length) return shot(pick(t.nbrs));

    if (adv) {
      // Sonar contacts are done once all their squares are resolved or a hit explains them.
      this.contacts = this.contacts.filter(([r, c]) => {
        const cells = patternCells('square', r, c);
        return cells.some(([a, b]) => this.huntable(a, b)) &&
          !cells.some(([a, b]) => this.foeBoard.cells[a][b].shot && this.foeBoard.cells[a][b].ship);
      });
      if (this.contacts.length) {
        const [r, c] = this.contacts[0];
        if (s.can('tomahawk')) return { type: 'tomahawk', r, c };
        return shot(pick(patternCells('square', r, c).filter(([a, b]) => this.huntable(a, b))));
      }
      for (const n of [1, 2]) {
        if (s.can('sq' + n) && Math.random() < 0.35) {
          const pattern = Math.random() < 0.5 ? 'x' : 'plus';
          const [r, c] = this.bestCenter(pattern);
          return { type: 'search', n, pattern, r, c };
        }
      }
      if (s.can('sonar') && Math.random() < 0.3) {
        const [r, c] = this.bestCenter('square');
        return { type: 'sonar', r, c };
      }
      if (s.can('torpedo') && Math.random() < 0.12) {
        let best = null, bestScore = -1;
        for (let r = 0; r < NUM_ROWS; r++) {
          let n = 0;
          for (let c = 0; c < NUM_COLS; c++) if (this.huntable(r, c)) n++;
          if (n > bestScore) { bestScore = n; best = { type: 'torpedo', dir: 'h', r, c: 0 }; }
        }
        for (let c = 0; c < NUM_COLS; c++) {
          let n = 0;
          for (let r = 0; r < NUM_ROWS; r++) if (this.huntable(r, c)) n++;
          if (n > bestScore) { bestScore = n; best = { type: 'torpedo', dir: 'v', r: 0, c }; }
        }
        if (best) return best;
      }
    }
    return this.huntShot();
  }

  // Plays the computer's whole turn and returns its events (a search may add a strike).
  takeTurn() {
    const events = [];
    let last;
    do {
      let ev = this.g.act(this.me, this.choose());
      if (ev.error) ev = this.g.act(this.me, this.huntShot());
      events.push(ev);
      if (ev.type === 'sonar' && ev.detected) this.contacts.push([ev.r, ev.c]);
      if (ev.type === 'aa' && ev.downed.length) ev.downed.forEach(n => { delete this.enemySq[n]; });
      last = ev;
      const ps = this.g.pendingStrike;
      if (ps && ps.side === this.me) {
        const [r, c] = pick(ps.cells);
        last = this.g.act(this.me, { type: 'strike', r, c });
        events.push(last);
      }
    } while (last.again && this.g.winner === null && events.length < 300);
    return events;
  }

  // Learn from the opponent's moves. Call right after each of their events.
  observe(ev) {
    if (!ev || ev.error || ev.side === this.me) return;
    if (ev.type === 'search') {
      // Work out where the squadron could be: any center whose pattern covers exactly
      // the squares it spotted among our afloat ships.
      const mine = this.side.board;
      const cands = [];
      for (let r = 0; r < NUM_ROWS; r++) {
        for (let c = 0; c < NUM_COLS; c++) {
          const cells = patternCells(ev.pattern, r, c);
          const seen = cells.filter(([a, b]) => mine.afloatAt(a, b));
          if (seen.length === ev.spotted.length &&
              seen.every(x => ev.spotted.some(y => sameCell(x, y)))) cands.push([r, c]);
        }
      }
      this.enemySq[ev.n] = { cands };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROWS, NUM_ROWS, NUM_COLS, FLEET, PATTERNS, coord, parseCoord, inBounds, patternCells, sameCell,
    Board, Side, Game, ComputerAI,
  };
}
