// Salvo Command — screen, keyboard and announcements.
'use strict';

(function () {
  const $ = id => document.getElementById(id);

  const live = $('status');
  let lastMessage = '';
  // Status reports and weapon changes pass remember = false, so Repeat still gives the last move.
  function announce(text, remember = true) {
    if (remember) lastMessage = text;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60);
  }

  // ---------- State ----------
  let phase = 'setup';           // 'setup' | 'battle' | 'over'
  let game = new Game(advancedChosen(), plusOneChosen());
  let ai = null;
  let horizontal = true;
  let current = FLEET[0].id;     // what's being placed: a ship id, 'sq1', 'sq2', or null when done
  let pendingStart = null;       // first end of a ship chosen on the grid, waiting for the other end
  let weapon = 'shot';
  let searchPattern = 'x';       // for squadrons
  let lineDir = 'h';             // for harpoons and torpedoes

  // Online play state (see "Online play" near the end of this file).
  const NET = { on: false, role: null, code: null, ref: null, db: null, st: null, busy: false, applied: 0, ready: false, connected: null, everConnected: false };
  let ME = 0;                    // which side of the game is this player: 0, or 1 when joining an online game as guest
  const me = () => game.sides[ME];
  const foe = () => game.sides[1 - ME];
  const myStrike = () => !!(game.pendingStrike && game.pendingStrike.side === ME);
  const FOE = () => (NET.on ? 'Opponent' : 'Computer');
  function advancedChosen() { return $('mode-advanced').checked; }
  function plusOneChosen() { return $('plus-one').checked; }
  function shipDef(id) { return FLEET.find(d => d.id === id); }
  function orientationWord() { return horizontal ? 'horizontal' : 'vertical'; }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function listWords(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
  const cellList = cells => listWords(cells.map(([r, c]) => coord(r, c)));
  // "aircraft carrier at A1 and A3, and your battleship at C1"
  function shipGroups(byShip) {
    const parts = Object.entries(byShip).map(([n, cells], i) => `${i ? 'your ' : ''}${n} at ${cellList(cells)}`);
    return parts.length <= 1 ? parts.join('') : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
  }

  function nextToPlace() {
    const d = FLEET.find(d => !me().board.ships[d.id]);
    if (d) return d.id;
    if (game.advanced) {
      const sq = me().squadrons.find(s => !s.cell);
      if (sq) return 'sq' + sq.n;
    }
    return null;
  }

  // ---------- Accessible grid ----------
  function makeGrid(el, opts) {
    el.innerHTML = '';
    el.setAttribute('role', 'grid');
    el.setAttribute('aria-label', opts.label);

    const head = document.createElement('div');
    head.className = 'grid-row grid-head';
    head.setAttribute('aria-hidden', 'true');
    head.appendChild(Object.assign(document.createElement('span'), { className: 'axis' }));
    for (let c = 0; c < NUM_COLS; c++) {
      head.appendChild(Object.assign(document.createElement('span'), { className: 'axis', textContent: c + 1 }));
    }
    el.appendChild(head);

    const cells = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'grid-row';
      row.setAttribute('role', 'row');
      const lab = document.createElement('span');
      lab.className = 'axis';
      lab.setAttribute('aria-hidden', 'true');
      lab.textContent = ROWS[r];
      row.appendChild(lab);
      cells.push([]);
      for (let c = 0; c < NUM_COLS; c++) {
        const cell = document.createElement('div');
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = -1;
        cell.dataset.r = r;
        cell.dataset.c = c;
        const mark = document.createElement('span');
        mark.setAttribute('aria-hidden', 'true');
        cell.appendChild(mark);
        row.appendChild(cell);
        cells[r].push(cell);
      }
      el.appendChild(row);
    }

    let cur = { r: 0, c: 0 };
    cells[0][0].tabIndex = 0;

    function focusCell(r, c) {
      r = Math.max(0, Math.min(NUM_ROWS - 1, r));
      c = Math.max(0, Math.min(NUM_COLS - 1, c));
      cells[cur.r][cur.c].tabIndex = -1;
      cur = { r, c };
      cells[r][c].tabIndex = 0;
      cells[r][c].focus();
    }

    // Type a square to jump: a letter picks the row, then 1 or 2 digits pick the column.
    let digitBuf = '', digitTime = 0;

    el.addEventListener('keydown', e => {
      if (e.altKey || e.metaKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'ArrowUp') focusCell(cur.r - 1, cur.c);
      else if (k === 'ArrowDown') focusCell(cur.r + 1, cur.c);
      else if (k === 'ArrowLeft') focusCell(cur.r, cur.c - 1);
      else if (k === 'ArrowRight') focusCell(cur.r, cur.c + 1);
      else if (k === 'Home') e.ctrlKey ? focusCell(0, 0) : focusCell(cur.r, 0);
      else if (k === 'End') e.ctrlKey ? focusCell(NUM_ROWS - 1, NUM_COLS - 1) : focusCell(cur.r, NUM_COLS - 1);
      else if (k === 'PageUp') focusCell(0, cur.c);
      else if (k === 'PageDown') focusCell(NUM_ROWS - 1, cur.c);
      else if (k === 'Enter' || k === ' ') opts.onActivate(cur.r, cur.c);
      else if (!e.ctrlKey && /^[a-j]$/.test(k)) {
        digitBuf = '';
        focusCell(ROWS.indexOf(k.toUpperCase()), cur.c);
      } else if (!e.ctrlKey && /^[0-9]$/.test(k)) {
        const now = Date.now();
        const two = parseInt(digitBuf + k, 10);
        if (digitBuf && now - digitTime <= 1000 && two >= 1 && two <= NUM_COLS) {
          digitBuf = '';
          focusCell(cur.r, two - 1);
        } else {
          digitBuf = k;
          const one = parseInt(k, 10);
          if (one >= 1) focusCell(cur.r, one - 1);
        }
        digitTime = now;
      } else if (!e.ctrlKey && opts.onKey) handled = opts.onKey(k);
      else handled = false;
      if (handled) e.preventDefault();
    });

    el.addEventListener('click', e => {
      const t = e.target.closest('[role="gridcell"]');
      if (!t) return;
      const r = +t.dataset.r, c = +t.dataset.c;
      focusCell(r, c);
      opts.onActivate(r, c);
    });

    function refresh() {
      for (let r = 0; r < NUM_ROWS; r++) {
        for (let c = 0; c < NUM_COLS; c++) {
          const cell = cells[r][c];
          const v = opts.view(r, c);
          cell.setAttribute('aria-label', v.label);
          cell.className = 'cell ' + v.cls;
          cell.firstChild.textContent = v.mark;
        }
      }
    }

    return { refresh, focusCell, get cur() { return cur; } };
  }

  // ---------- Cell descriptions ----------
  function playerView(r, c) {
    const v = playerCellView(r, c);
    if (phase === 'setup' && pendingStart && sameCell(pendingStart, [r, c])) { v.label += ', selected'; v.cls += ' pending'; }
    return v;
  }
  function playerCellView(r, c) {
    const s = me();
    const cell = s.board.cells[r][c];
    const pos = coord(r, c);
    if (cell.ship) {
      const name = shipDef(cell.ship).name;
      if (s.board.isSunk(cell.ship)) return { label: `${pos}, ${name}, sunk`, cls: 'ship sunk', mark: '✕' };
      if (cell.shot) return { label: `${pos}, ${name}, hit`, cls: 'ship hit', mark: '✕' };
      const sq = game.advanced && s.squadronOnDeckAt(r, c);
      if (sq) return { label: `${pos}, ${name}, attack squadron ${sq.n}`, cls: 'ship', mark: String(sq.n) };
      return { label: `${pos}, ${name}`, cls: 'ship', mark: '' };
    }
    if (cell.shot) return { label: `${pos}, miss`, cls: 'miss', mark: '•' };
    return { label: pos, cls: '', mark: '' };
  }

  function enemyView(r, c) {
    const s = foe();
    const cell = s.board.cells[r][c];
    const pos = coord(r, c);
    const overhead = me().squadrons.filter(q => q.status === 'airborne' && sameCell(q.pos, [r, c]));
    const sqText = overhead.length ? `, your squadron ${overhead.map(q => q.n).join(' and ')} overhead` : '';
    let v;
    if (cell.shot && cell.ship) {
      v = s.board.isSunk(cell.ship)
        ? { label: `${pos}, ${shipDef(cell.ship).name}, sunk`, cls: 'hit sunk', mark: '✕' }
        : { label: `${pos}, hit`, cls: 'hit', mark: '✕' };
    } else if (cell.shot) {
      v = { label: `${pos}, miss`, cls: 'miss', mark: '•' };
    } else if (phase === 'over' && cell.ship) {
      v = { label: `${pos}, ${shipDef(cell.ship).name}`, cls: 'ship', mark: '' };
    } else if (me().knowledge[r][c] === 'spotted') {
      v = { label: `${pos}, ship spotted`, cls: 'spotted', mark: '?' };
    } else if (me().knowledge[r][c] === 'clear') {
      v = { label: `${pos}, clear`, cls: 'clear', mark: '' };
    } else {
      v = { label: pos, cls: '', mark: '' };
    }
    if (overhead.length) {
      v.label += sqText;
      v.cls += ' overhead';
      if (!v.mark) v.mark = '✈';
    }
    return v;
  }

  // ---------- Grids ----------
  const playerGrid = makeGrid($('player-grid'), {
    label: 'Your fleet',
    view: playerView,
    onActivate: (r, c) => {
      if (phase === 'setup') gridPlace(r, c);
      else if (phase === 'battle' && weapon === 'aa' && !game.pendingStrike) doAction({ type: 'aa', r, c });
    },
    onKey: k => {
      if (phase === 'setup' && (k === 'r' || k === 'R')) { rotate(); return true; }
      if (phase === 'setup' && k === 'Escape' && pendingStart) { pendingStart = null; playerGrid.refresh(); announce('Selection cleared.'); return true; }
      return battleKey(k);
    },
  });

  const enemyGrid = makeGrid($('enemy-grid'), {
    label: 'Enemy waters',
    view: enemyView,
    onActivate: (r, c) => enemyActivate(r, c),
    onKey: k => battleKey(k),
  });

  function battleKey(k) {
    if (k === 'l' || k === 'L') { if (lastMessage) announce(lastMessage, false); return true; }
    if (phase !== 'battle') return false;
    if (k === 's' || k === 'S') { announce(fleetReport(), false); return true; }
    if (!game.advanced) return false;
    if (k === 'w') { cycleWeapon(1); return true; }
    if (k === 'W') { cycleWeapon(-1); return true; }
    if (k === 'r' || k === 'R') { togglePattern(); return true; }
    return false;
  }

  // ---------- Setup ----------
  function placingText() {
    if (!current) return 'All set. Start the battle when ready.';
    if (current.startsWith('sq')) return `Place attack squadron ${current[2]} on a carrier square.`;
    const d = shipDef(current);
    return `Placing ${d.name}, ${d.size} spaces, ${orientationWord()}.`;
  }

  function updateSetup() {
    const locked = NET.on && NET.ready;
    $('placing').textContent = locked ? LOCKED : placingText();
    $('rotate').textContent = `Rotate (now ${orientationWord()})`;
    $('start').textContent = NET.on ? "I'm ready" : 'Start battle';
    $('start').disabled = !me().ready() || locked;
    for (const id of ['rotate', 'random', 'clear']) $(id).disabled = locked;
    playerGrid.refresh();
  }

  // On the grid a ship can be placed by choosing both of its ends, or by choosing one square twice,
  // which places the current ship from there in the Rotate direction.
  function gridPlace(r, c) {
    if (NET.on && NET.ready) { announce(LOCKED); return; }
    const there = me().board.cells[r][c].ship;
    if (pendingStart) {
      const [a, b] = pendingStart;
      pendingStart = null;
      if (a === r && b === c) { placeAt(r, c); return; }
      if (a === r || b === c) { placeSpan(a, b, r, c); return; }
    }
    if (there || !current || current.startsWith('sq')) { playerGrid.refresh(); placeAt(r, c); return; }
    pendingStart = [r, c];
    playerGrid.refresh();
    announce(`${coord(r, c)} selected. Now the other end.`);
  }

  // Places a ship from one end to the other. The length picks the ship: the one being placed if it fits,
  // otherwise the first unplaced ship of that length.
  function placeSpan(r1, c1, r2, c2) {
    if (NET.on && NET.ready) { announce(LOCKED); return; }
    if (r1 !== r2 && c1 !== c2) { announce('A ship runs straight along a row or down a column.'); return; }
    const s = me();
    const len = Math.abs(r1 - r2) + Math.abs(c1 - c2) + 1;
    const cur = current && !current.startsWith('sq') ? shipDef(current) : null;
    const d = cur && cur.size === len ? cur : FLEET.find(x => x.size === len && !s.board.ships[x.id]);
    if (!d) {
      if (!FLEET.some(x => x.size === len)) announce(`No ship is ${len} spaces long. Ships are 5, 4, 3, 3 and 2 spaces.`);
      else announce(`Every ${len}-space ship is already placed. Choose one on the grid to pick it up first.`);
      return;
    }
    const from = coord(r1, c1), to = coord(r2, c2);
    if (!s.board.place(d, Math.min(r1, r2), Math.min(c1, c2), r1 === r2)) {
      announce(`The ${d.name} doesn't fit from ${from} to ${to}.`);
      return;
    }
    const cells = s.board.ships[d.id].cells;
    current = nextToPlace();
    updateSetup();
    announce(`${capital(d.name)} placed, ${coord(...cells[0])} to ${coord(...cells[cells.length - 1])}. ${placingText()}`);
  }

  function placeAt(r, c) {
    if (NET.on && NET.ready) { announce(LOCKED); return; }
    const s = me();
    const there = s.board.cells[r][c].ship;

    // Placing a squadron on the carrier.
    if (current && current.startsWith('sq') && there === 'carrier') {
      const n = +current[2];
      if (!s.placeSquadron(n, r, c)) { announce(`Attack squadron ${3 - n} is already at ${coord(r, c)}.`); return; }
      current = nextToPlace();
      updateSetup();
      announce(`Attack squadron ${n} on the carrier at ${coord(r, c)}. ${current ? placingText() : 'All set. Start the battle when ready.'}`);
      return;
    }
    // Everything placed: choosing a squadron's square picks the squadron back up.
    if (!current && there === 'carrier' && game.advanced) {
      const sq = s.squadrons.find(q => sameCell(q.cell, [r, c]));
      if (sq) {
        sq.cell = null;
        current = 'sq' + sq.n;
        updateSetup();
        announce(`Picked up attack squadron ${sq.n}. ${placingText()}`);
        return;
      }
    }
    // Choosing a ship picks it up.
    if (there) {
      if (there === 'carrier') s.clearSquadrons();
      s.board.remove(there);
      current = there;
      updateSetup();
      const extra = there === 'carrier' && game.advanced ? ' Its squadrons come off too.' : '';
      announce(`Picked up ${shipDef(there).name}.${extra} ${placingText()}`);
      return;
    }
    if (!current) { announce(placingText()); return; }
    if (current.startsWith('sq')) { announce('Squadrons go on a carrier square.'); return; }

    const d = shipDef(current);
    if (!s.board.place(d, r, c, horizontal)) {
      announce(`The ${d.name} doesn't fit ${orientationWord()}ly from ${coord(r, c)}.`);
      return;
    }
    const cells = s.board.ships[d.id].cells;
    current = nextToPlace();
    updateSetup();
    announce(`${capital(d.name)} placed, ${coord(...cells[0])} to ${coord(...cells[cells.length - 1])}. ${placingText()}`);
  }

  function rotate() {
    horizontal = !horizontal;
    pendingStart = null;
    updateSetup();
    announce(capital(orientationWord()) + '.');
  }

  function fleetLayout() {
    const s = me();
    let text = FLEET.map(d => {
      const cells = s.board.ships[d.id].cells;
      return `${d.name} ${coord(...cells[0])} to ${coord(...cells[cells.length - 1])}`;
    }).join(', ') + '.';
    if (game.advanced) text += ` Squadrons at ${cellList(s.squadrons.map(q => q.cell))}.`;
    return text;
  }

  $('rotate').addEventListener('click', rotate);
  $('random').addEventListener('click', () => {
    pendingStart = null;
    me().board.randomize();
    if (game.advanced) me().randomSquadrons();
    current = null;
    updateSetup();
    announce('Fleet placed randomly. ' + fleetLayout());
  });
  $('clear').addEventListener('click', () => {
    pendingStart = null;
    me().board.clear();
    me().clearSquadrons();
    current = nextToPlace();
    updateSetup();
    announce('Grid cleared. ' + placingText());
  });
  for (const id of ['mode-basic', 'mode-advanced']) {
    $(id).addEventListener('change', () => {
      game.setAdvanced(advancedChosen());
      if (game.advanced && me().board.allPlaced() && !me().squadronsPlaced()) me().randomSquadrons();
      current = nextToPlace();
      updateSetup();
    });
  }
  $('start').addEventListener('click', startBattle);
  $('place-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('place-input');
    const parts = (input.value.match(/[a-z]\s*-?\s*\d{1,2}/gi) || []).map(parseCoord);
    if (!parts.length || parts.length > 2 || parts.some(p => !p)) {
      announce('Type one square, like C7, or both ends of a ship, like D4 H4.');
      return;
    }
    input.value = '';
    pendingStart = null;
    if (parts.length === 2) placeSpan(parts[0].r, parts[0].c, parts[1].r, parts[1].c);
    else placeAt(parts[0].r, parts[0].c);
  });  $('repeat').addEventListener('click', () => announce(lastMessage || placingText(), false));
  $('status-btn').addEventListener('click', () => announce(fleetReport(), false));

  // ---------- Weapons ----------
  function weaponOptions() {
    const s = me();
    const out = [{ id: 'shot', label: 'Standard shot' }];
    if (!game.advanced) return out;
    for (const q of s.squadrons) {
      if (s.can('sq' + q.n)) out.push({ id: 'sq' + q.n, label: `Attack squadron ${q.n}, ${q.status === 'airborne' ? 'airborne' : 'on carrier'}` });
    }
    if (s.can('tomahawk')) out.push({ id: 'tomahawk', label: 'Tomahawk, 1 left' });
    if (s.can('harpoon')) out.push({ id: 'harpoon', label: `Harpoon, ${s.ammo.harpoon} left` });
    if (s.can('torpedo')) out.push({ id: 'torpedo', label: `Torpedo, ${s.ammo.torpedo} left` });
    if (s.can('sonar')) out.push({ id: 'sonar', label: 'Sonar' });
    out.push({ id: 'aa', label: 'Antiaircraft battery' });
    return out;
  }

  function patternOptions() {
    if (weapon === 'sq1' || weapon === 'sq2') return { label: 'Search pattern', value: searchPattern, opts: [['x', 'X pattern'], ['plus', 'Plus pattern']] };
    if (weapon === 'harpoon' || weapon === 'torpedo') return { label: 'Direction', value: lineDir, opts: [['h', 'Horizontal'], ['v', 'Vertical']] };
    return null;
  }

  function patternWord() {
    const p = patternOptions();
    return p ? p.opts.find(o => o[0] === p.value)[1] : '';
  }

  function updateWeapons() {
    const opts = weaponOptions();
    if (!opts.some(o => o.id === weapon)) weapon = 'shot';
    const sel = $('weapon');
    sel.innerHTML = '';
    for (const o of opts) sel.appendChild(new Option(o.label, o.id, false, o.id === weapon));
    const p = patternOptions();
    $('pattern-wrap').hidden = !p;
    if (p) {
      $('pattern-label').textContent = p.label;
      const ps = $('pattern');
      ps.innerHTML = '';
      for (const [v, t] of p.opts) ps.appendChild(new Option(t, v, false, v === p.value));
    }
  }

  function weaponLabel() {
    const o = weaponOptions().find(o => o.id === weapon);
    const p = patternOptions();
    return o.label + (p ? `, ${patternWord()}` : '') + '.';
  }

  function cycleWeapon(step) {
    const opts = weaponOptions();
    const i = opts.findIndex(o => o.id === weapon);
    weapon = opts[(i + step + opts.length) % opts.length].id;
    updateWeapons();
    announce(weaponLabel(), false);
  }

  function togglePattern() {
    if (weapon === 'sq1' || weapon === 'sq2') searchPattern = searchPattern === 'x' ? 'plus' : 'x';
    else if (weapon === 'harpoon' || weapon === 'torpedo') lineDir = lineDir === 'h' ? 'v' : 'h';
    else { announce('This weapon has no pattern.'); return; }
    updateWeapons();
    announce(patternWord() + '.', false);
  }

  $('weapon').addEventListener('change', e => { weapon = e.target.value; updateWeapons(); });
  $('pattern').addEventListener('change', e => {
    if (weapon === 'sq1' || weapon === 'sq2') searchPattern = e.target.value;
    else lineDir = e.target.value;
  });

  // ---------- Battle ----------
  function startBattle() {
    if (NET.on) { readyOnline(); return; }
    if (!me().ready()) return;
    game.plusOne = plusOneChosen();
    foe().board.randomize();
    if (game.advanced) foe().randomSquadrons();
    ai = new ComputerAI(game, 1);
    showBattle();
    announce(`Battle stations, ${game.advanced ? 'advanced' : 'basic'} weapons${game.plusOne ? ', target plus 1' : ''}. You fire first.`);
  }

  // Switches the screen from setup to the battle.
  function showBattle() {
    phase = 'battle';
    weapon = 'shot';
    $('setup').hidden = true;
    $('enemy-section').hidden = false;
    $('fleet-status').hidden = false;
    $('log-section').hidden = false;
    $('status-btn').hidden = false;
    $('player-hint').hidden = true;
    $('weapon-controls').hidden = !game.advanced;
    $('log').innerHTML = '';
    refreshAll();
    enemyGrid.focusCell(0, 0);
  }

  function enemyActivate(r, c) {
    if (phase !== 'battle') return;
    if (myStrike()) { doAction({ type: 'strike', r, c }); return; }
    switch (weapon) {
      case 'shot': doAction({ type: 'shot', r, c }); break;
      case 'sq1': case 'sq2': doAction({ type: 'search', n: +weapon[2], pattern: searchPattern, r, c }); break;
      case 'tomahawk': doAction({ type: 'tomahawk', r, c }); break;
      case 'harpoon': doAction({ type: 'harpoon', dir: lineDir, r, c }); break;
      case 'torpedo': doAction({ type: 'torpedo', dir: lineDir, r, c }); break;
      case 'sonar': doAction({ type: 'sonar', r, c }); break;
      case 'aa': announce('The antiaircraft battery fires over your own waters. Choose a square on your fleet grid.'); break;
    }
  }

  function strikePrompt() {
    const ps = game.pendingStrike;
    return `Squadron ${ps.n} strikes: choose ${cellList(ps.cells).replace(/ and ([^ ]+)$/, ' or $1')}.`;
  }

  function doAction(a) {
    if (phase !== 'battle') return;
    if (NET.on) { sendOnline(a); return; }
    const ev = game.act(ME, a);
    if (ev.error) { announce(ev.error); return; }
    ai.observe(ev);
    let msg = describe(ev, true);
    addLog(msg);

    if (myStrike()) {
      refreshAll();
      announce(`${msg} ${strikePrompt()}`);
      return;
    }
    if (game.winner === ME) { endGame(true, msg); return; }
    if (ev.again) {
      refreshAll();
      announce(`${msg} Go again.`);
      return;
    }

    const reply = ai.takeTurn().map(e => describe(e, false)).join(' ');
    addLog(reply);
    msg += ' ' + reply;
    if (game.winner === 1 - ME) { endGame(false, msg); return; }

    refreshAll();
    announce(msg);
  }

  $('fire-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('fire-input');
    const p = parseCoord(input.value);
    if (!p) { announce('Type a square from A1 to J14, like C7.'); return; }
    input.value = '';
    if (weapon === 'aa' && !game.pendingStrike) doAction({ type: 'aa', r: p.r, c: p.c });
    else enemyActivate(p.r, p.c);
  });

  // ---------- Words for what happened ----------
  function damageText(results, mine) {
    const hits = results.filter(x => x.result === 'hit' || x.result === 'sunk');
    const parts = [];
    if (mine) {
      parts.push(hits.length ? `hit${hits.length > 1 ? 's' : ''} at ${cellList(hits.map(x => [x.r, x.c]))}.` : 'no hits.');
      for (const x of hits) if (x.result === 'sunk') parts.push(`You sank their ${x.ship.def.name}!`);
      for (const x of results) if (x.squadronLost) parts.push(`Enemy attack squadron ${x.squadronLost} destroyed on their carrier.`);
    } else {
      if (!hits.length) parts.push('no damage.');
      else {
        const byShip = {};
        for (const x of hits) (byShip[x.ship.def.name] = byShip[x.ship.def.name] || []).push([x.r, x.c]);
        parts.push('hits your ' + shipGroups(byShip) + '.');
      }
      for (const x of hits) if (x.result === 'sunk') parts.push(`Your ${x.ship.def.name} is sunk!`);
      for (const x of results) if (x.squadronLost) parts.push(`Your attack squadron ${x.squadronLost} was destroyed on the carrier.`);
    }
    return parts.join(' ');
  }

  function shotText(x, mine) {
    const pos = coord(x.r, x.c);
    let t;
    if (mine) {
      t = x.result === 'miss' ? `${pos}, miss.` : x.result === 'hit' ? `${pos}, hit!` : `${pos}, hit. You sank their ${x.ship.def.name}!`;
      if (x.squadronLost) t += ` Enemy attack squadron ${x.squadronLost} destroyed on their carrier.`;
    } else {
      t = x.result === 'miss' ? `${FOE()} fires at ${pos}, miss.`
        : x.result === 'hit' ? `${FOE()} fires at ${pos}, hits your ${x.ship.def.name}.`
        : `${FOE()} fires at ${pos} and sinks your ${x.ship.def.name}!`;
      if (x.squadronLost) t += ` Your attack squadron ${x.squadronLost} was destroyed on the carrier.`;
    }
    return t;
  }

  function describe(ev, mine) {
    const pos = ev.r !== undefined ? coord(ev.r, ev.c) : '';
    const pat = p => (p === 'x' ? 'an X' : 'a plus');
    const dirWord = d => (d === 'h' ? 'horizontal' : 'vertical');
    switch (ev.type) {
      case 'shot':
        return shotText(ev.results[0], mine);
      case 'search': {
        if (mine) {
          const verb = ev.launched ? 'launches and searches' : 'searches';
          return `Squadron ${ev.n} ${verb} ${pat(ev.pattern)} pattern at ${pos}: ` +
            (ev.spotted.length ? `ships spotted at ${cellList(ev.spotted)}.` : 'no ships.');
        }
        if (!ev.spotted.length) return `Enemy attack squadron ${ev.n} searches in ${pat(ev.pattern)} pattern and finds nothing.`;
        const byShip = {};
        for (const [r, c] of ev.spotted) {
          const n = shipDef(me().board.cells[r][c].ship).name;
          (byShip[n] = byShip[n] || []).push([r, c]);
        }
        return `Enemy attack squadron ${ev.n} searches in ${pat(ev.pattern)} pattern and spots your ${shipGroups(byShip)}.`;
      }
      case 'strike': {
        const x = ev.results[0];
        if (mine) {
          let t = `Squadron ${ev.n} strikes ${pos}: ` +
            (x.result === 'miss' ? 'miss.' : x.result === 'hit' ? 'hit!' : `hit. You sank their ${x.ship.def.name}!`);
          if (x.squadronLost) t += ` Enemy attack squadron ${x.squadronLost} destroyed on their carrier.`;
          return t;
        }
        return `It strikes ${pos}: ` + (x.result === 'miss' ? 'miss.' : damageText(ev.results, false));
      }
      case 'tomahawk':
        return (mine ? `Tomahawk around ${pos}: ` : `Enemy Tomahawk strikes around ${pos}: `) + damageText(ev.results, mine);
      case 'harpoon':
        return (mine ? `Harpoon, ${dirWord(ev.dir)}, at ${pos}: ` : `Enemy harpoon, ${dirWord(ev.dir)}, at ${pos}: `) + damageText(ev.results, mine);
      case 'torpedo': {
        const lane = ev.dir === 'h' ? `row ${ROWS[ev.r]}` : `column ${ev.c + 1}`;
        const head = mine ? `Torpedo from ${coord(...ev.start)} along ${lane}: ` : `Enemy torpedo along ${lane}: `;
        if (!ev.contact) return head + (mine ? 'no contact.' : 'no damage.');
        if (ev.alreadyDamaged) {
          return head + (mine ? `struck an already damaged section at ${coord(...ev.contact)}.`
            : `struck your already damaged ${shipDef(me().board.cells[ev.contact[0]][ev.contact[1]].ship).name} at ${coord(...ev.contact)}.`);
        }
        return head + damageText(ev.results, mine);
      }
      case 'sonar':
        return mine ? `Sonar at ${pos}: ${ev.detected ? 'enemy ship detected' : 'confirmed clear waters'}.` : 'The enemy sub uses sonar.';
      case 'aa':
        if (mine) return `Antiaircraft fire at ${pos}: ` + (ev.downed.length ? `shot down enemy attack squadron ${listWords(ev.downed.map(String))}!` : 'miss.');
        return `Enemy antiaircraft fire at ${pos}: ` + (ev.downed.length ? `shot down your attack squadron ${listWords(ev.downed.map(String))}!` : 'miss.');
      default:
        return '';
    }
  }

  function addLog(text) {
    const li = document.createElement('li');
    li.textContent = text;
    const log = $('log');
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 40) log.removeChild(log.lastChild);
  }

  // ---------- Status ----------
  function shipStatus(board, d, revealDamage) {
    if (board.isSunk(d.id)) return `${d.name}, sunk`;
    const s = board.ships[d.id];
    if (revealDamage && s.hits) return `${d.name}, ${s.hits} of ${d.size} hit`;
    return `${d.name}, afloat`;
  }

  function weaponsText() {
    const s = me();
    const parts = [];
    for (const q of s.squadrons) {
      if (q.status === 'destroyed') parts.push(`squadron ${q.n} lost`);
      else if (q.status === 'airborne') parts.push(`squadron ${q.n} over ${coord(...q.pos)}${q.struck ? '' : ', strike ready'}`);
      else parts.push(`squadron ${q.n} on carrier`);
    }
    if (s.can('tomahawk')) parts.push('Tomahawk ready');
    if (s.can('harpoon')) parts.push(`${s.ammo.harpoon} harpoon${s.ammo.harpoon > 1 ? 's' : ''}`);
    if (s.can('torpedo')) parts.push(`${s.ammo.torpedo} torpedo${s.ammo.torpedo > 1 ? 'es' : ''}`);
    if (s.can('sonar')) parts.push('sonar');
    return parts;
  }

  function fleetReport() {
    const enemyLeft = FLEET.filter(d => !foe().board.isSunk(d.id));
    const mine = me().board;
    const mineLeft = FLEET.filter(d => !mine.isSunk(d.id));
    let text = enemyLeft.length ? `Enemy afloat: ${enemyLeft.map(d => d.name).join(', ')}.` : 'Enemy fleet destroyed.';
    if (game.advanced) {
      const downed = foe().squadrons.filter(q => q.status === 'destroyed').map(q => q.n);
      if (downed.length) text += ` Enemy squadrons lost: ${listWords(downed.map(String))}.`;
    }
    if (!mineLeft.length) return text + ' Your fleet is destroyed.';
    text += ` You have ${mineLeft.length} of 5 ships afloat.`;
    const damaged = mineLeft.filter(d => mine.ships[d.id].hits > 0).map(d => `${d.name} ${mine.ships[d.id].hits} of ${d.size} hit`);
    const lost = FLEET.filter(d => mine.isSunk(d.id)).map(d => d.name);
    if (damaged.length) text += ` Damaged: ${damaged.join('; ')}.`;
    if (lost.length) text += ` Lost: ${lost.join('; ')}.`;
    if (game.advanced) text += ` Weapons: ${weaponsText().join('; ')}.`;
    return text;
  }

  function updateFleetStatus() {
    const fill = (id, items) => {
      const ul = $(id);
      ul.innerHTML = '';
      for (const [text, sunk] of items) {
        const li = document.createElement('li');
        li.textContent = text;
        if (sunk) li.className = 'sunk';
        ul.appendChild(li);
      }
    };
    fill('enemy-ships', FLEET.map(d => [shipStatus(foe().board, d, false), foe().board.isSunk(d.id)]));
    fill('player-ships', FLEET.map(d => [shipStatus(me().board, d, true), me().board.isSunk(d.id)]));
    $('weapons-wrap').hidden = !game.advanced;
    if (game.advanced) fill('player-weapons', weaponsText().map(t => [t, false]));
  }

  function refreshAll() {
    renderOnline();
    $('restart').hidden = NET.on || phase !== 'battle';
    enemyGrid.refresh();
    playerGrid.refresh();
    updateFleetStatus();
    updateWeapons();
  }

  function endGame(won, lastShot) {
    phase = 'over';
    refreshAll();
    const shots = foe().board.shotsTaken();
    const sank = FLEET.filter(d => foe().board.isSunk(d.id)).length;
    const summary = won
      ? `Victory! You sank the entire enemy fleet, hitting ${shots} squares.`
      : `Defeat. ${NET.on ? 'Your opponent' : 'The computer'} sank your whole fleet. You sank ${sank} of 5 ships. Enemy ships are now shown on their grid.`;
    lastMessage = `${lastShot} ${summary}`;
    $('over-text').textContent = lastMessage;
    $('over').hidden = false;
    $('weapon-controls').hidden = true;
    $('over-text').focus();
  }

  // Single player: start over from setup, keeping your fleet where it is. Press twice to confirm.
  let restartTimer = null;
  $('restart').addEventListener('click', () => {
    if (NET.on || phase !== 'battle') return;
    const b = $('restart');
    if (!restartTimer) {
      b.textContent = 'Press again to restart';
      announce('Press Restart game again within five seconds to abandon this game.', false);
      restartTimer = setTimeout(() => { restartTimer = null; b.textContent = 'Restart game'; }, 5000);
      return;
    }
    const keep = fleetData(me());
    resetToSetup();
    loadFleet(me(), keep);
    current = nextToPlace();
    updateSetup();
    announce(`Game restarted. Your fleet is where you had it. ${current ? placingText() : 'Start the battle when ready, or move ships first.'}`);
  });

  $('new-game').addEventListener('click', () => {
    if (NET.on) { leaveOnline(); return; }
    resetToSetup();
    announce('New game. ' + placingText());
  });

  // Back to a fresh setup against the computer (also used when leaving or entering an online game).
  function resetToSetup() {
    ME = 0;
    pendingStart = null;
    clearTimeout(restartTimer); restartTimer = null; $('restart').textContent = 'Restart game';
    game = new Game(advancedChosen(), plusOneChosen());
    ai = null;
    phase = 'setup';
    horizontal = true;
    weapon = 'shot';
    current = nextToPlace();
    $('over').hidden = true;
    $('enemy-section').hidden = true;
    $('fleet-status').hidden = true;
    $('log-section').hidden = true;
    $('status-btn').hidden = true;
    $('setup').hidden = false;
    $('player-hint').hidden = false;
    $('log').innerHTML = '';
    updateSetup();
    renderOnline();
    playerGrid.focusCell(0, 0);
  }

  // ---------- Online play (Firebase Realtime Database) ----------
  // Each game lives at salvoCommand/CODE as { ver, state, t, by, act }. state is JSON:
  // { opts: {advanced, plusOne}, host: {dev, fleet}, guest: {dev, fleet} | null, actions: [[side, action], ...], resign: null | 'host' | 'guest' }
  // The host is side 0 and fires first. Once both fleets are in, every device rebuilds the same game by
  // replaying the actions through the rules engine, which has no randomness, so both players always agree.
  // The rules (database.rules.json) only accept each change as exactly one version newer than the last.
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const SESSION_KEY = 'sc-online';
  const WEB_HOME = 'https://christopherabel3000-creator.github.io/Advanced-Battleship/';
  const CONN_ERR = 'Could not reach the online game server. Check your internet connection and try again.';
  const NO_NET = "Online play isn't available right now.";
  const LOCKED = 'Your fleet is locked in. The battle starts when your opponent is ready.';

  const DEVICE = (() => {
    let id = null;
    try { id = localStorage.getItem('sc-device'); } catch (e) {}
    if (!id) {
      id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem('sc-device', id); } catch (e) {}
    }
    return id;
  })();
  const isNativeApp = () => { try { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; } };
  // In the App Store app the page has no web address of its own, so the invite link points at the game's website.
  const inviteLink = code => (isNativeApp() ? WEB_HOME : location.origin + location.pathname) + '?g=' + code;
  const foeRole = () => (NET.role === 'host' ? 'guest' : 'host');
  const hasFleet = (st, k) => !!(st && st[k] && st[k].fleet);
  const showErr = t => { $('on-err').textContent = t; };
  function saveSession(code) { try { if (code) localStorage.setItem(SESSION_KEY, code); else localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function loadSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function setUrl(code) { try { history.replaceState(null, '', code ? '?g=' + code : location.pathname); } catch (e) {} }

  function netReady() { const c = window.FIREBASE_CONFIG; return typeof firebase !== 'undefined' && !!c && !!c.apiKey && !!c.databaseURL; }
  function netDb() {
    if (!NET.db) {
      const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      NET.db = app.database();
      NET.db.ref('.info/connected').on('value', snap => {
        const c = !!snap.val(), had = NET.everConnected, was = NET.connected;
        NET.connected = c;
        if (c) NET.everConnected = true;
        if (!NET.on || !had || was === c) return;
        addLog(c ? 'Reconnected to the online game.' : 'Connection lost. Trying to reconnect.');
        announce(c ? 'Reconnected.' : 'Connection lost. Trying to reconnect.', false);
      });
    }
    return NET.db;
  }
  // Change the shared game safely. fn edits the parsed state; returning false cancels the change.
  function txn(ref, fn, act) {
    return ref.transaction(cur => {
      if (cur === null) return null;
      let st; try { st = JSON.parse(cur.state); } catch (e) { return; }
      if (fn(st) === false) return;
      return { ver: cur.ver + 1, state: JSON.stringify(st), t: Date.now(), by: DEVICE, act };
    }, null, false).then(res => res.committed && res.snapshot.exists());
  }

  // A fleet as stored online: each ship's first square and direction, and the squadrons' carrier squares.
  function fleetData(side) {
    const ships = {};
    for (const d of FLEET) {
      const s = side.board.ships[d.id];
      ships[d.id] = [s.cells[0][0], s.cells[0][1], s.horizontal ? 1 : 0];
    }
    return { ships, sq: game.advanced ? side.squadrons.map(q => q.cell) : null };
  }
  function loadFleet(side, f) {
    side.board.clear();
    for (const d of FLEET) {
      const p = f.ships && f.ships[d.id];
      if (!p || !side.board.place(d, p[0], p[1], !!p[2])) return false;
    }
    if (side.advanced) {
      if (!Array.isArray(f.sq) || f.sq.length !== 2) return false;
      for (let i = 0; i < 2; i++) if (!f.sq[i] || !side.placeSquadron(i + 1, f.sq[i][0], f.sq[i][1])) return false;
    }
    return true;
  }
  // Rebuilds the whole game from the shared record. Returns null if the record doesn't make sense.
  function buildGame(st, upTo) {
    const g = new Game(!!st.opts.advanced, !!st.opts.plusOne);
    if (!loadFleet(g.sides[0], st.host.fleet) || !loadFleet(g.sides[1], st.guest.fleet)) return null;
    const n = upTo === undefined ? st.actions.length : upTo;
    for (let k = 0; k < n; k++) {
      const [side, a] = st.actions[k];
      if (g.act(side, a).error) return null;
    }
    return g;
  }

  async function hostOnline() {
    showErr('');
    if (!netReady()) return showErr(NO_NET);
    const db = netDb();
    try {
      for (let i = 0; i < 6; i++) {
        const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
        const ref = db.ref('salvoCommand/' + code);
        // A game nobody has touched in a week is cleared away, so its code can be used again.
        try { const cur = (await ref.once('value')).val(); if (cur && cur.t < Date.now() - 7 * 86400000 - 60000) await ref.remove(); } catch (e) { /* the code is just taken */ }
        const st = { opts: { advanced: advancedChosen(), plusOne: plusOneChosen() }, host: { dev: DEVICE, fleet: null }, guest: null, actions: [], resign: null };
        const res = await ref.transaction(cur => (cur ? undefined : { ver: 1, state: JSON.stringify(st), t: Date.now(), by: DEVICE, act: 'create' }), null, false);
        if (res.committed) return enterOnline(code, 'host', ref, st);
      }
      showErr('Could not create a game code. Try again.');
    } catch (e) { showErr(CONN_ERR); }
  }

  async function joinOnline(raw) {
    showErr('');
    if (!netReady()) return showErr(NO_NET);
    const code = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!/^[A-Z]{4}$/.test(code)) return showErr('Game codes are four letters, like KDRT.');
    const ref = netDb().ref('salvoCommand/' + code);
    try {
      const v = (await ref.once('value')).val();
      if (!v) return showErr(`There's no game with code ${code}. Check the code with your friend.`);
      const st = JSON.parse(v.state);
      if (st.host && st.host.dev === DEVICE) return enterOnline(code, 'host', ref, st);
      if (st.guest && st.guest.dev === DEVICE) return enterOnline(code, 'guest', ref, st);
      if (st.guest) return showErr(`Game ${code} already has two players.`);
      const ok = await txn(ref, s => { if (s.guest && s.guest.dev !== DEVICE) return false; if (!s.guest) s.guest = { dev: DEVICE, fleet: null }; }, 'join');
      if (!ok) return showErr(`Game ${code} already has two players.`);
      enterOnline(code, 'guest', ref, st);
    } catch (e) { showErr(CONN_ERR); }
  }

  function enterOnline(code, role, ref, st) {
    if (NET.ref) NET.ref.off();
    // The host's choice of weapons and turn rules applies to both players.
    $('mode-advanced').checked = !!st.opts.advanced;
    $('mode-basic').checked = !st.opts.advanced;
    $('plus-one').checked = !!st.opts.plusOne;
    Object.assign(NET, { on: true, role, code, ref, st: null, busy: false, applied: 0, ready: false });
    resetToSetup();
    ME = role === 'host' ? 0 : 1;
    saveSession(code); setUrl(code); showErr('');
    const rules = `${st.opts.advanced ? 'Advanced' : 'Basic'} weapons${st.opts.plusOne ? ', target plus 1' : ''}.`;
    const text = role === 'host'
      ? `You're hosting online game ${code}. ${rules} Send your friend the code or the invite link, and place your fleet while you wait.`
      : `You joined online game ${code}. ${rules} Place your fleet, then press I'm ready.`;
    addLog(text);
    announce(text);
    updateSetup();
    renderOnline();
    ref.on('value', snap => onRemote(snap.val()), () => showErr(CONN_ERR));
  }

  function leaveOnline() {
    const keep = phase === 'battle' ? NET.code : null;
    if (NET.ref) NET.ref.off();
    Object.assign(NET, { on: false, role: null, code: null, ref: null, st: null, busy: false, applied: 0, ready: false });
    saveSession(keep); setUrl(null);
    resetToSetup();
    announce(keep ? `You left the online game. You can rejoin game ${keep} later from the Online play section.` : 'You left the online game. You are now playing the computer.');
  }

  function onRemote(v) {
    if (!NET.on) return;
    if (!v) { showErr(`Online game ${NET.code} no longer exists.`); return; }
    let st; try { st = JSON.parse(v.state); } catch (e) { return; }
    const prev = NET.st, mine = NET.role, them = foeRole();
    NET.st = st;
    if (mine === 'host' && prev && st.guest && !prev.guest) { addLog('Your opponent joined the game.'); announce('Your opponent joined the game.', false); }
    if (hasFleet(st, mine) && !NET.ready) {
      // Coming back to a game: put the fleet we sent back on the grid.
      if (phase === 'setup') { loadFleet(me(), st[mine].fleet); current = null; }
      NET.ready = true;
    }
    if (phase === 'setup') {
      if (hasFleet(st, 'host') && hasFleet(st, 'guest')) beginOnline(st);
      else {
        if (prev && hasFleet(st, mine) && !hasFleet(prev, mine)) { addLog("You're ready. Waiting for your opponent to place their fleet."); announce("You're ready. Waiting for your opponent to place their fleet."); }
        if (prev && hasFleet(st, them) && !hasFleet(prev, them)) { addLog('Your opponent has placed their fleet.'); announce('Your opponent has placed their fleet.', false); }
        updateSetup();
      }
    } else if (phase === 'battle') syncActions(st);
    if (st.resign && phase === 'battle') {
      const text = st.resign === mine ? 'You resigned.' : 'Your opponent resigned.';
      addLog(text);
      endGame(st.resign !== mine, text);
    }
    renderOnline();
  }

  function beginOnline(st) {
    const g = buildGame(st, 0);
    if (!g) { showErr('This online game has a problem with a fleet. Leave it and host a new one.'); return; }
    game = g;
    ME = NET.role === 'host' ? 0 : 1;
    NET.applied = 0;
    showBattle();
    const replaying = st.actions.length > 0;
    const first = ME === 0 ? 'You fire first.' : 'Your opponent fires first.';
    addLog('Both fleets are ready. ' + first);
    syncActions(st, replaying);
    if (replaying && phase === 'battle') {
      announce(`Rejoined game ${NET.code} after ${st.actions.length} moves. ` + (game.turn === ME ? 'Your turn.' : "Your opponent's turn."));
    } else if (!replaying) {
      announce(`Battle stations, ${game.advanced ? 'advanced' : 'basic'} weapons${game.plusOne ? ', target plus 1' : ''}. ${first}`);
    }
  }

  // Applies any new actions from the shared record, then says what happened.
  function syncActions(st, quiet) {
    const msgs = [];
    let lastSide = null;
    while (NET.applied < st.actions.length && game.winner === null) {
      const [side, a] = st.actions[NET.applied];
      const ev = game.act(side, a);
      NET.applied++;
      if (ev.error) {
        addLog('The game got out of step with your opponent. Leave the online game and rejoin it with the same code to reload it.');
        break;
      }
      const text = describe(ev, side === ME);
      addLog(text);
      msgs.push(text);
      lastSide = side;
    }
    if (!msgs.length) { refreshAll(); return; }
    let text = msgs.join(' ');
    if (game.winner !== null) { endGame(game.winner === ME, text); return; }
    refreshAll();
    if (quiet) return;
    if (myStrike()) text += ' ' + strikePrompt();
    else if (game.turn === ME) text += lastSide === ME ? ' Go again.' : ' Your turn.';
    announce(text);
  }

  function sendOnline(a) {
    if (NET.busy) return announce('Still sending your last move. One moment.', false);
    if (game.turn !== ME) return announce("It's your opponent's turn.", false);
    // Try the move on a copy first, so a mistake gets its message without being sent.
    const test = buildGame(NET.st, NET.applied);
    const ev = test ? test.act(ME, a) : { error: 'The game is still loading.' };
    if (ev.error) return announce(ev.error);
    const n = NET.applied;
    NET.busy = true;
    txn(NET.ref, st => { if (st.actions.length !== n || st.resign) return false; st.actions.push([ME, a]); }, 'act')
      .then(ok => { NET.busy = false; if (!ok) announce("Your move didn't go through because the game changed. Check the battle log and try again."); })
      .catch(() => { NET.busy = false; announce("Your move didn't go through because the connection dropped. Try again."); });
  }

  function readyOnline() {
    if (NET.ready) return announce(LOCKED);
    if (!me().ready()) return announce(placingText());
    if (NET.busy) return;
    const fleet = fleetData(me());
    NET.busy = true;
    txn(NET.ref, st => { if (!st[NET.role] || st[NET.role].fleet) return false; st[NET.role].fleet = fleet; }, 'ready')
      .then(ok => { NET.busy = false; if (!ok && !NET.ready) announce("Couldn't send your fleet. Try again."); })
      .catch(() => { NET.busy = false; announce(CONN_ERR); });
  }

  let resignTimer = null;
  function resignOnline() {
    if (!NET.on || phase !== 'battle') return;
    const b = $('resign');
    if (!resignTimer) {
      b.textContent = 'Press again to resign';
      announce('Press Resign again within five seconds to give up this game.', false);
      resignTimer = setTimeout(() => { resignTimer = null; b.textContent = 'Resign'; }, 5000);
      return;
    }
    clearTimeout(resignTimer); resignTimer = null; b.textContent = 'Resign';
    txn(NET.ref, st => { if (st.resign) return false; st.resign = NET.role; }, 'resign').catch(() => announce(CONN_ERR));
  }

  function renderOnline() {
    $('on-off').hidden = NET.on;
    $('on-on').hidden = !NET.on;
    const saved = !NET.on && loadSession();
    $('rejoin').hidden = !saved;
    if (saved) $('rejoin').textContent = `Rejoin game ${saved}`;
    for (const id of ['mode-basic', 'mode-advanced', 'plus-one']) $(id).disabled = NET.on;
    if (!NET.on) return;
    $('on-code').textContent = NET.code.split('').join(' ');
    $('on-link').textContent = inviteLink(NET.code);
    $('resign').hidden = phase !== 'battle';
    const st = NET.st, them = foeRole();
    let s = 'Connecting.';
    if (st) {
      if (!st[them]) s = 'Waiting for your opponent to join.';
      else if (phase === 'setup') s = hasFleet(st, them) ? 'Your opponent is ready.' : 'Your opponent is placing their fleet.';
      else if (phase === 'battle') s = game.turn === ME ? 'Your turn.' : "Your opponent's turn.";
      else s = 'Game over.';
    }
    $('on-status').textContent = 'Status: ' + s;
  }

  function bootOnline() {
    let code = null;
    try { const m = location.search.match(/[?&]g=([A-Za-z]{4})\b/); if (m) code = m[1].toUpperCase(); } catch (e) {}
    if (code) joinOnline(code);
    renderOnline();
  }

  $('host').addEventListener('click', hostOnline);
  $('rejoin').addEventListener('click', () => joinOnline(loadSession()));
  $('join-form').addEventListener('submit', e => { e.preventDefault(); joinOnline($('join-code').value); });
  $('leave').addEventListener('click', leaveOnline);
  $('resign').addEventListener('click', resignOnline);
  $('copy-link').addEventListener('click', async () => {
    const link = inviteLink(NET.code);
    try { await navigator.clipboard.writeText(link); announce('Invite link copied.', false); }
    catch (e) {
      try { const r = document.createRange(); r.selectNodeContents($('on-link')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e2) {}
      announce('Copying was blocked, so the invite link is selected. Press Control C, or Command C on a Mac, to copy it.', false);
    }
  });

  updateSetup();
  bootOnline();
})();
