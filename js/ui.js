// Advanced Battleship — screen, keyboard and announcements.
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
  let weapon = 'shot';
  let searchPattern = 'x';       // for squadrons
  let lineDir = 'h';             // for harpoons and torpedoes

  const me = () => game.sides[0];
  const foe = () => game.sides[1];
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
      if (phase === 'setup') placeAt(r, c);
      else if (phase === 'battle' && weapon === 'aa' && !game.pendingStrike) doAction({ type: 'aa', r, c });
    },
    onKey: k => {
      if (phase === 'setup' && (k === 'r' || k === 'R')) { rotate(); return true; }
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
    $('placing').textContent = placingText();
    $('rotate').textContent = `Rotate (now ${orientationWord()})`;
    $('start').disabled = !me().ready();
    playerGrid.refresh();
  }

  function placeAt(r, c) {
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
    me().board.randomize();
    if (game.advanced) me().randomSquadrons();
    current = null;
    updateSetup();
    announce('Fleet placed randomly. ' + fleetLayout());
  });
  $('clear').addEventListener('click', () => {
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
    const p = parseCoord(input.value);
    if (!p) { announce('Type a square from A1 to J14, like C7.'); return; }
    input.value = '';
    placeAt(p.r, p.c);
  });
  $('repeat').addEventListener('click', () => announce(lastMessage || placingText(), false));
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
    if (!me().ready()) return;
    game.plusOne = plusOneChosen();
    foe().board.randomize();
    if (game.advanced) foe().randomSquadrons();
    ai = new ComputerAI(game, 1);
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
    announce(`Battle stations, ${game.advanced ? 'advanced' : 'basic'} weapons${game.plusOne ? ', target plus 1' : ''}. You fire first.`);
  }

  function enemyActivate(r, c) {
    if (phase !== 'battle') return;
    if (game.pendingStrike && game.pendingStrike.side === 0) { doAction({ type: 'strike', r, c }); return; }
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

  function doAction(a) {
    if (phase !== 'battle') return;
    const ev = game.act(0, a);
    if (ev.error) { announce(ev.error); return; }
    ai.observe(ev);
    let msg = describe(ev, true);
    addLog(msg);

    if (game.pendingStrike && game.pendingStrike.side === 0) {
      refreshAll();
      const cells = game.pendingStrike.cells;
      announce(`${msg} Squadron ${ev.n} strikes: choose ${cellList(cells).replace(/ and ([^ ]+)$/, ' or $1')}.`);
      return;
    }
    if (game.winner === 0) { endGame(true, msg); return; }
    if (ev.again) {
      refreshAll();
      announce(`${msg} Go again.`);
      return;
    }

    const reply = ai.takeTurn().map(e => describe(e, false)).join(' ');
    addLog(reply);
    msg += ' ' + reply;
    if (game.winner === 1) { endGame(false, msg); return; }

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
      t = x.result === 'miss' ? `Computer fires at ${pos}, miss.`
        : x.result === 'hit' ? `Computer fires at ${pos}, hits your ${x.ship.def.name}.`
        : `Computer fires at ${pos} and sinks your ${x.ship.def.name}!`;
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
      : `Defeat. The computer sank your whole fleet. You sank ${sank} of 5 ships. Enemy ships are now shown on their grid.`;
    lastMessage = `${lastShot} ${summary}`;
    $('over-text').textContent = lastMessage;
    $('over').hidden = false;
    $('weapon-controls').hidden = true;
    $('over-text').focus();
  }

  $('new-game').addEventListener('click', () => {
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
    updateSetup();
    playerGrid.focusCell(0, 0);
    announce('New game. ' + placingText());
  });

  updateSetup();
})();
