(() => {
  'use strict';

  const SIZE = 4;
  const TARGET = 2048;
  const SAVE_KEY = 'slideclub-game-v1';
  const BEST_KEY = 'slideclub-best-v1';
  const SOUND_KEY = 'slideclub-sound-v1';
  const boardEl = document.getElementById('board');
  const tilesEl = document.getElementById('tiles');
  const gridEl = boardEl.querySelector('.board-grid');
  for (let i = 0; i < SIZE * SIZE; i++) gridEl.appendChild(document.createElement('span'));
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const timeEl = document.getElementById('time');
  const undoButton = document.getElementById('undo-button');
  const restartButton = document.getElementById('restart-button');
  const overlay = document.getElementById('board-overlay');
  const toast = document.getElementById('toast');
  const soundButton = document.getElementById('sound-toggle');
  const scorePop = document.getElementById('score-pop');
  let nextId = 1;
  let undoState = null;
  let toastTimer;
  let audioContext;
  let soundOn = safeGet(SOUND_KEY) === 'on';
  let pointerStart = null;
  let state = freshState();
  let best = Number(safeGet(BEST_KEY)) || 0;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function freshState() {
    return { board: Array(SIZE * SIZE).fill(null), score: 0, elapsed: 0, startedAt: null, won: false, over: false, continued: false };
  }
  function copyBoard(board) { return board.map(tile => tile ? { ...tile } : null); }
  function elapsedNow() { return state.elapsed + (state.startedAt ? Date.now() - state.startedAt : 0); }
  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ board: state.board, score: state.score, elapsed: elapsedNow(), won: state.won, over: state.over, continued: state.continued, nextId }));
      localStorage.setItem(BEST_KEY, String(best));
    } catch (_) { /* Private browsing can disable storage; the game still works. */ }
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!saved || !Array.isArray(saved.board) || saved.board.length !== SIZE * SIZE) return false;
      if (!saved.board.every(tile => tile === null || (Number.isInteger(tile.val) && tile.val >= 2 && Number.isInteger(tile.id)))) return false;
      state = { board: saved.board, score: Number(saved.score) || 0, elapsed: Number(saved.elapsed) || 0, startedAt: Number(saved.elapsed) > 0 && !saved.over ? Date.now() : null, won: Boolean(saved.won), over: Boolean(saved.over), continued: Boolean(saved.continued) };
      nextId = Math.max(Number(saved.nextId) || 1, ...state.board.filter(Boolean).map(tile => tile.id + 1));
      return true;
    } catch (_) { return false; }
  }
  function randomEmpty() {
    const empty = [];
    state.board.forEach((tile, i) => { if (!tile) empty.push(i); });
    if (!empty.length) return false;
    const index = empty[Math.floor(Math.random() * empty.length)];
    state.board[index] = { id: nextId++, val: Math.random() < 0.9 ? 2 : 4 };
    return true;
  }
  function initGame() {
    state = freshState();
    undoState = null;
    randomEmpty(); randomEmpty();
    hideOverlay();
    render();
    save();
    boardEl.focus({ preventScroll: true });
  }
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 1700);
  }
  function tick() {
    timeEl.textContent = formatTime(elapsedNow());
    if (state.startedAt) save();
  }
  function render() {
    const existing = new Map([...tilesEl.children].map(element => [Number(element.dataset.id), element]));
    const present = new Set();
    state.board.forEach((tile, index) => {
      if (!tile) return;
      present.add(tile.id);
      let element = existing.get(tile.id);
      const isNew = !element;
      if (!element) {
        element = document.createElement('div');
        element.className = 'tile';
        element.dataset.id = String(tile.id);
        element.setAttribute('role', 'presentation');
        tilesEl.appendChild(element);
      }
      const row = Math.floor(index / SIZE);
      const col = index % SIZE;
      const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 8;
      const inner = tilesEl.clientWidth;
      const cell = (inner - gap * 3) / SIZE;
      element.style.width = `${cell}px`;
      element.style.height = `${cell}px`;
      element.style.left = `${col * (cell + gap)}px`;
      element.style.top = `${row * (cell + gap)}px`;
      element.textContent = String(tile.val);
      element.className = `tile ${tile.val <= 2048 ? `tile-${tile.val}` : 'tile-super'}${tile.justMerged ? ' merged' : ''}`;
      if (isNew) element.style.animationDelay = `${Math.random() * 45}ms`;
      delete tile.justMerged;
    });
    for (const [id, element] of existing) if (!present.has(id)) element.remove();
    scoreEl.textContent = state.score.toLocaleString();
    bestEl.textContent = best.toLocaleString();
    timeEl.textContent = formatTime(elapsedNow());
    undoButton.disabled = !undoState;
    boardEl.setAttribute('aria-label', `2048 game board. Score ${state.score}. Use arrow keys or swipe to move tiles.`);
    if (state.over) showEndOverlay();
    else if (state.won && !state.continued) showWinOverlay();
  }
  function playSound(merged = false) {
    if (!soundOn) return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(merged ? 520 : 300, audioContext.currentTime);
      if (merged) osc.frequency.exponentialRampToValueAtTime(760, audioContext.currentTime + .08);
      gain.gain.setValueAtTime(.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .11);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + .12);
    } catch (_) { /* Audio is an optional flourish. */ }
  }
  function flashScore(points) {
    if (!points) return;
    scorePop.textContent = `+${points}`;
    scorePop.classList.remove('show');
    void scorePop.offsetWidth;
    scorePop.classList.add('show');
  }

  function indicesFor(direction, line) {
    const indices = [];
    for (let step = 0; step < SIZE; step++) {
      if (direction === 'left') indices.push(line * SIZE + step);
      if (direction === 'right') indices.push(line * SIZE + (SIZE - 1 - step));
      if (direction === 'up') indices.push(step * SIZE + line);
      if (direction === 'down') indices.push((SIZE - 1 - step) * SIZE + line);
    }
    return indices;
  }
  function canMove() {
    if (state.board.some(tile => !tile)) return true;
    for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
      const value = state.board[row * SIZE + col].val;
      if (col < SIZE - 1 && value === state.board[row * SIZE + col + 1].val) return true;
      if (row < SIZE - 1 && value === state.board[(row + 1) * SIZE + col].val) return true;
    }
    return false;
  }
  function move(direction) {
    if (state.over || (state.won && !state.continued)) return;
    const before = copyBoard(state.board);
    const previousScore = state.score;
    let gained = 0;
    let didMove = false;
    for (let line = 0; line < SIZE; line++) {
      const indices = indicesFor(direction, line);
      const original = indices.map(index => state.board[index]).filter(Boolean);
      const compacted = [];
      for (let i = 0; i < original.length; i++) {
        if (i + 1 < original.length && original[i].val === original[i + 1].val) {
          const val = original[i].val * 2;
          compacted.push({ id: nextId++, val, justMerged: true });
          gained += val;
          i++;
        } else compacted.push(original[i]);
      }
      const result = [...compacted, ...Array(SIZE - compacted.length).fill(null)];
      indices.forEach((index, i) => {
        const previous = state.board[index];
        const next = result[i];
        if ((previous?.id ?? null) !== (next?.id ?? null)) didMove = true;
        state.board[index] = next;
      });
    }
    if (!didMove) return;
    undoState = { board: before, score: previousScore };
    const elapsedBeforeMove = elapsedNow();
    if (!state.startedAt) state.startedAt = Date.now();
    else state.startedAt = Date.now() - elapsedBeforeMove;
    state.score += gained;
    if (state.score > best) {
      best = state.score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) {}
    }
    const made2048 = state.board.some(tile => tile?.val >= TARGET);
    randomEmpty();
    if (made2048 && !state.won) state.won = true;
    if (!canMove()) state.over = true;
    render();
    flashScore(gained);
    playSound(gained > 0);
    save();
    if (state.over) showEndOverlay();
    else if (made2048 && !state.continued) showWinOverlay();
  }
  function undo() {
    if (!undoState) return;
    state.board = copyBoard(undoState.board);
    state.score = undoState.score;
    state.over = false;
    if (state.won && !state.board.some(tile => tile?.val >= TARGET)) state.won = false;
    undoState = null;
    hideOverlay();
    render(); save();
    showToast('One move rewound. Your time keeps flowing.');
  }
  function makeButton(text, handler, secondary = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = text;
    if (secondary) button.className = 'secondary';
    button.addEventListener('click', handler);
    return button;
  }
  function setOverlay(title, message, buttons) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-message').textContent = message;
    const actions = document.getElementById('overlay-actions');
    actions.replaceChildren(...buttons);
    overlay.hidden = false;
  }
  function hideOverlay() { overlay.hidden = true; }
  function showWinOverlay() {
    setOverlay('You made 2048!', 'A lovely bit of focus. Want to see how far you can go?', [
      makeButton('Keep going', () => { state.continued = true; hideOverlay(); render(); save(); }),
      makeButton('New game', initGame, true)
    ]);
  }
  function showEndOverlay() {
    setOverlay('No more moves.', `You scored ${state.score.toLocaleString()} in ${formatTime(elapsedNow())}. Fancy another go?`, [
      makeButton('Play again', initGame),
      makeButton('Undo last', undo, true)
    ]);
  }
  function showRestartPrompt() {
    if (state.score === 0 && !state.startedAt) { initGame(); return; }
    setOverlay('A fresh start?', 'This game is going rather nicely. Are you sure you want to begin again?', [
      makeButton('Start fresh', initGame),
      makeButton('Keep playing', () => { hideOverlay(); boardEl.focus({ preventScroll: true }); }, true)
    ]);
  }

  // Listen at the document level as well: some mobile browsers move focus to
  // the body after restoring a page from the service-worker cache.
  const directions = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  boardEl.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    boardEl.focus({ preventScroll: true });
    const rect = boardEl.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue('--gap')) || 8;
    const inner = rect.width - gap * 2;
    const cell = (inner - gap * 3) / 4;
    const x = event.clientX - rect.left - gap;
    const y = event.clientY - rect.top - gap;
    pointerStart = { x: event.clientX, y: event.clientY, row: Math.floor(y / (cell + gap)), col: Math.floor(x / (cell + gap)) };
    if (boardEl.setPointerCapture && event.pointerId !== undefined) boardEl.setPointerCapture(event.pointerId);
  });
  boardEl.addEventListener('pointerup', event => {
    if (!pointerStart) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const threshold = Math.max(20, boardEl.clientWidth * .055);
    if (Math.max(Math.abs(dx), Math.abs(dy)) > threshold) {
      move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    } else {
      const { row, col } = pointerStart;
      if (row >= 0 && row < SIZE && col >= 0 && col < SIZE) tapCell(row, col);
    }
    pointerStart = null;
  });
  boardEl.addEventListener('pointercancel', () => { pointerStart = null; });
  function tapCell(row, col) {
    const index = row * SIZE + col;
    if (state.board[index]) {
      const choices = [[row - 1, col, 'down'], [row + 1, col, 'up'], [row, col - 1, 'right'], [row, col + 1, 'left']];
      for (const [r, c, direction] of choices) if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && !state.board[r * SIZE + c]) { move(direction); return; }
    } else {
      const choices = [[row - 1, col, 'down'], [row + 1, col, 'up'], [row, col - 1, 'right'], [row, col + 1, 'left']];
      for (const [r, c, direction] of choices) if (r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.board[r * SIZE + c]) { move(direction); return; }
    }
  }
  undoButton.addEventListener('click', undo);
  restartButton.addEventListener('click', showRestartPrompt);
  soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    soundButton.classList.toggle('is-on', soundOn);
    soundButton.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
    soundButton.title = soundOn ? 'Sound on' : 'Sound off';
    try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (_) {}
    if (soundOn) playSound(false);
  });
  window.addEventListener('keydown', event => {
    if (directions[event.key] && overlay.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
      event.preventDefault();
      move(directions[event.key]);
    }
    if (event.key === 'Escape' && !overlay.hidden) hideOverlay();
    if (event.key.toLowerCase() === 'u' && !event.ctrlKey && !event.metaKey && !event.altKey && overlay.hidden) undo();
  });
  window.addEventListener('beforeunload', save);
  window.addEventListener('resize', render);
  setInterval(tick, 1000);

  if (!load()) { randomEmpty(); randomEmpty(); }
  soundButton.classList.toggle('is-on', soundOn);
  soundButton.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
  soundButton.title = soundOn ? 'Sound on' : 'Sound off';
  if (state.over) showEndOverlay();
  else if (state.won && !state.continued) showWinOverlay();
  render();
  save();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
