// Advanced Battleship — screen, keyboard and announcements.
'use strict';

(function () {
  const $ = id => document.getElementById(id);

  const live = $('status');
  let lastMessage = '';
  function announce(text) {
    lastMessage = text;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60);
  }

  // ---------- Game state ----------
  let phase = 'setup';            // 'setup' | 'battle' | 'over'
  let player = new Board();
  let enemy = new Board();
  let ai = new ComputerAI();
  let horizontal = true;
  let currentShipId = FLEET[0].id;

  function shipDef(id) { return FLEET.find(d => d.id === id); }
  function firstUnplaced() {
    const d = FLEET.find(d => !player.ships[d.id]);
    return d ? d.id : null;
  }
  function orientationWord() { return horizontal ? 'horizontal' : 'vertical'; }

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

    // Type a coordinate to jump: a letter picks the row, then 1 or 2 digits pick the column.
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
      else if (!e.ctrlKey && /^[a-j]$/i.test(k)) {
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
      } else if (!e.ctrlKey && opts.onKey) handled = opts.onKey(k, cur.r, cur.c);
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
    const cell = player.cells[r][c];
    const pos = coord(r, c);
    if (cell.ship) {
      const name = shipDef(cell.ship).name;
      if (player.isSunk(cell.ship)) return { label: `${pos}, ${name}, sunk`, cls: 'ship sunk', mark: '✕' };
      if (cell.shot) return { label: `${pos}, ${name}, hit`, cls: 'ship hit', mark: '✕' };
      return { label: `${pos}, ${name}`, cls: 'ship', mark: '' };
    }
    if (cell.shot) return { label: `${pos}, miss`, cls: 'miss', mark: '•' };
    return { label: pos, cls: '', mark: '' };
  }

  function enemyView(r, c) {
    const cell = enemy.cells[r][c];
    const pos = coord(r, c);
    if (cell.shot && cell.ship) {
      if (enemy.isSunk(cell.ship)) {
        return { label: `${pos}, ${shipDef(cell.ship).name}, sunk`, cls: 'hit sunk', mark: '✕' };
      }
      return { label: `${pos}, hit`, cls: 'hit', mark: '✕' };
    }
    if (cell.shot) return { label: `${pos}, miss`, cls: 'miss', mark: '•' };
    if (phase === 'over' && cell.ship) {
      return { label: `${pos}, ${shipDef(cell.ship).name}`, cls: 'ship', mark: '' };
    }
    return { label: pos, cls: '', mark: '' };
  }

  // ---------- Grids ----------
  const playerGrid = makeGrid($('player-grid'), {
    label: 'Your fleet',
    view: playerView,
    onActivate: (r, c) => { if (phase === 'setup') placeAt(r, c); },
    onKey: (k, r, c) => {
      if (phase === 'setup' && (k === 'r' || k === 'R')) { rotate(); return true; }
      return commonKey(k);
    },
  });

  const enemyGrid = makeGrid($('enemy-grid'), {
    label: 'Enemy waters',
    view: enemyView,
    onActivate: (r, c) => fireAt(r, c),
    onKey: k => commonKey(k),
  });

  function commonKey(k) {
    if (k === 'l' || k === 'L') { if (lastMessage) announce(lastMessage); return true; }
    if ((k === 's' || k === 'S') && phase !== 'setup') { announce(fleetReport()); return true; }
    return false;
  }

  // ---------- Setup ----------
  function placingText() {
    if (!currentShipId) return 'All ships placed. Start the battle when ready.';
    const d = shipDef(currentShipId);
    return `Placing ${d.name}, ${d.size} spaces, ${orientationWord()}.`;
  }

  function updateSetup() {
    $('placing').textContent = placingText();
    $('rotate').textContent = `Rotate (now ${orientationWord()})`;
    $('start').disabled = !player.allPlaced();
    playerGrid.refresh();
  }

  function placeAt(r, c) {
    const there = player.cells[r][c].ship;
    if (there) {
      player.remove(there);
      currentShipId = there;
      updateSetup();
      announce(`Picked up ${shipDef(there).name}. ${placingText()}`);
      return;
    }
    if (!currentShipId) { announce(placingText()); return; }
    const d = shipDef(currentShipId);
    if (!player.place(d, r, c, horizontal)) {
      announce(`The ${d.name} doesn't fit ${orientationWord()}ly from ${coord(r, c)}.`);
      return;
    }
    const cells = player.ships[d.id].cells;
    const from = coord(...cells[0]), to = coord(...cells[cells.length - 1]);
    currentShipId = firstUnplaced();
    updateSetup();
    const next = currentShipId
      ? `Next, ${shipDef(currentShipId).name}, ${shipDef(currentShipId).size} spaces.`
      : 'All ships placed. Start the battle when ready.';
    announce(`${capital(d.name)} placed, ${from} to ${to}. ${next}`);
  }

  function rotate() {
    horizontal = !horizontal;
    updateSetup();
    announce(capital(orientationWord()) + '.');
  }

  $('rotate').addEventListener('click', rotate);
  $('random').addEventListener('click', () => {
    player.randomize();
    currentShipId = null;
    updateSetup();
    announce('Fleet placed randomly. ' + fleetLayout());
  });
  $('clear').addEventListener('click', () => {
    player.clear();
    currentShipId = FLEET[0].id;
    updateSetup();
    announce('Grid cleared. ' + placingText());
  });
  $('start').addEventListener('click', startBattle);

  function fleetLayout() {
    return FLEET.map(d => {
      const cells = player.ships[d.id].cells;
      return `${d.name} ${coord(...cells[0])} to ${coord(...cells[cells.length - 1])}`;
    }).join(', ') + '.';
  }

  // ---------- Battle ----------
  function startBattle() {
    if (!player.allPlaced()) return;
    enemy.randomize();
    ai = new ComputerAI();
    phase = 'battle';
    $('setup').hidden = true;
    $('enemy-section').hidden = false;
    $('fleet-status').hidden = false;
    $('player-hint').hidden = true;
    enemyGrid.refresh();
    playerGrid.refresh();
    updateFleetStatus();
    enemyGrid.focusCell(0, 0);
    announce('Battle stations. You fire first.');
  }

  function fireAt(r, c) {
    if (phase !== 'battle') return;
    const res = enemy.fire(r, c);
    const pos = coord(r, c);
    if (res.result === 'repeat') { announce(`Already fired at ${pos}.`); return; }

    let msg;
    if (res.result === 'miss') msg = `${pos}, miss.`;
    else if (res.result === 'hit') msg = `${pos}, hit!`;
    else msg = `${pos}, hit. You sank their ${res.ship.def.name}!`;

    if (enemy.allSunk()) { endGame(true, msg); return; }

    const shot = ai.nextShot();
    const back = player.fire(shot.r, shot.c);
    ai.report(shot.r, shot.c, back);
    const bpos = coord(shot.r, shot.c);
    if (back.result === 'miss') msg += ` Computer fires at ${bpos}, miss.`;
    else if (back.result === 'hit') msg += ` Computer fires at ${bpos}, hits your ${back.ship.def.name}.`;
    else msg += ` Computer fires at ${bpos} and sinks your ${back.ship.def.name}!`;

    if (player.allSunk()) { endGame(false, msg); return; }

    enemyGrid.refresh();
    playerGrid.refresh();
    updateFleetStatus();
    announce(msg);
  }

  $('fire-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('fire-input');
    const p = parseCoord(input.value);
    if (!p) { announce('Type a square from A1 to J14, like C7.'); return; }
    input.value = '';
    fireAt(p.r, p.c);
  });

  function shipStatus(board, d, revealDamage) {
    if (board.isSunk(d.id)) return `${d.name}, sunk`;
    const s = board.ships[d.id];
    if (revealDamage && s.hits) return `${d.name}, ${s.hits} of ${d.size} hit`;
    return `${d.name}, afloat`;
  }

  function fleetReport() {
    const enemyLeft = FLEET.filter(d => !enemy.isSunk(d.id));
    const mineLeft = FLEET.filter(d => !player.isSunk(d.id));
    const enemyPart = enemyLeft.length
      ? `Enemy afloat: ${enemyLeft.map(d => d.name).join(', ')}.`
      : 'Enemy fleet destroyed.';
    const damaged = mineLeft.filter(d => player.ships[d.id].hits > 0)
      .map(d => `${d.name} ${player.ships[d.id].hits} of ${d.size} hit`);
    const lost = FLEET.filter(d => player.isSunk(d.id)).map(d => d.name);
    let minePart;
    if (!mineLeft.length) minePart = 'Your fleet is destroyed.';
    else {
      minePart = `You have ${mineLeft.length} of 5 ships afloat.`;
      if (damaged.length) minePart += ` Damaged: ${damaged.join('; ')}.`;
      if (lost.length) minePart += ` Lost: ${lost.join('; ')}.`;
    }
    return `${enemyPart} ${minePart}`;
  }

  function updateFleetStatus() {
    const fill = (id, board, reveal) => {
      const ul = $(id);
      ul.innerHTML = '';
      for (const d of FLEET) {
        const li = document.createElement('li');
        li.textContent = shipStatus(board, d, reveal);
        if (board.isSunk(d.id)) li.className = 'sunk';
        ul.appendChild(li);
      }
    };
    fill('enemy-ships', enemy, false);
    fill('player-ships', player, true);
  }

  function endGame(won, lastShot) {
    phase = 'over';
    enemyGrid.refresh();
    playerGrid.refresh();
    updateFleetStatus();
    const shots = enemy.shotsTaken();
    const summary = won
      ? `Victory! You sank the entire enemy fleet in ${shots} shots.`
      : `Defeat. The computer sank your whole fleet. You fired ${shots} shots and sank ${FLEET.filter(d => enemy.isSunk(d.id)).length} of 5 ships. Enemy ships are now shown on their grid.`;
    lastMessage = `${lastShot} ${summary}`;
    $('over-text').textContent = lastMessage;
    $('over').hidden = false;
    $('over-text').focus();
  }

  $('new-game').addEventListener('click', () => {
    player = new Board();
    enemy = new Board();
    ai = new ComputerAI();
    phase = 'setup';
    horizontal = true;
    currentShipId = FLEET[0].id;
    $('over').hidden = true;
    $('enemy-section').hidden = true;
    $('fleet-status').hidden = true;
    $('setup').hidden = false;
    $('player-hint').hidden = false;
    updateSetup();
    playerGrid.focusCell(0, 0);
    announce('New game. ' + placingText());
  });

  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  updateSetup();
  $('placing').textContent = placingText();
})();
