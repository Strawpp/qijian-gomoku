import {
  BLACK, EMPTY, SIZE, WHITE, blankBoard, colorName, coordinate, counts, createGame,
  findWinningMoves, opposite, outcomeOf, positionOf, roundUndoLength, validGame,
} from './game.js';
import { boardHit, drawBoard } from './board.js?v=2';
import { detectGrid, gridPoint, identifyStones, readImage, validCorners } from './recognition.js';

const byId = (id) => document.getElementById(id);
const canvas = byId('board');
const storageKey = 'qijian.gomoku.v1';
const upper = { follow: '好友跟盘', engine: '人机对弈' };
const photoDialog = byId('photo-dialog');
const photoCanvas = byId('photo');
const ultimateDialog = byId('ultimate-dialog');
const ultimateSeconds = byId('ultimate-seconds');
const cornerNames = ['左上角', '右上角', '右下角', '左下角'];
const quickSearchMs = 500;
const deepSearchMs = 6000;

let game = createGame();
let previous = null;
let position = positionOf(game);
let result = null;
let draft = null;
let reference = null;
let photoMode = 'review';
let photoCorners = [];
let selected = null;
let cursor = null;
let suggestion = null;
let analysisNotice = null;
let enginePaused = false;
let revision = 0;
let worker = null;
let activeJob = null;
let nextJob = null;
let jobTimer;
let firstSuggestionTimer;
let loadingImage = false;
let toastTimer;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (validGame(saved?.game)) game = saved.game;
  if (validGame(saved?.previous)) previous = { game: saved.previous, reference: null };
  enginePaused = saved?.paused === true;
} catch {
  // 私密窗口或旧数据损坏时仍允许正常下棋。
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ game, previous: previous?.game, paused: enginePaused }));
  } catch {
    // 浏览器拒绝持久化时，当前标签页仍保留本局。
  }
}

function toast(message) {
  const box = byId('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 3000);
}

function invalidateAnalysis() {
  // 每次确认修改都产生新版本，旧局面的返回值不能提交棋子。
  revision++;
  nextJob = null;
  suggestion = null;
  analysisNotice = null;
  clearTimeout(firstSuggestionTimer);
  if (ultimateDialog.open) ultimateDialog.close();
  if (activeJob && activeJob.mode !== 'quick') stopActiveSearch();
}

function stopActiveSearch() {
  // 单线程引擎在搜索期间无法接收消息，结束 Worker 才能立即停止旧搜索。
  clearTimeout(jobTimer);
  clearTimeout(firstSuggestionTimer);
  worker?.terminate();
  worker = null;
  activeJob = null;
}

function updateGame(nextGame, { pause = false } = {}) {
  game = nextGame;
  position = positionOf(game);
  result = outcomeOf(position.board, position.last);
  selected = null;
  enginePaused = pause;
  invalidateAnalysis();
  save();
  scheduleAnalysis();
  render();
}

function scheduleAnalysis(mode = game.mode === 'follow' ? 'auto' : 'quick',
  time = mode === 'quick' ? quickSearchMs : deepSearchMs) {
  const myTurn = position.next === game.player;
  const shouldSearch = game.mode === 'follow' ? myTurn : !myTurn;
  if (draft || result || enginePaused || !shouldSearch || activeJob?.id === revision) return;
  if ((mode === 'deep' || mode === 'ultimate')
      && (!suggestion || game.mode !== 'follow' || selected !== null)) return;
  nextJob = {
    id: revision,
    board: position.board,
    next: position.next,
    mode,
    time,
  };
  analysisNotice = null;
  runNextJob();
}

function runNextJob() {
  if (activeJob || !nextJob) return;
  activeJob = nextJob;
  nextJob = null;
  activeJob.startedAt = performance.now();
  try {
    if (!worker) {
      const currentWorker = new Worker(new URL('./engine-worker.js?v=5', import.meta.url));
      worker = currentWorker;
      currentWorker.onmessage = ({ data }) => {
        if (worker !== currentWorker) return;
        if (data.type === 'candidate') acceptCandidate(data);
        else finishAnalysis(data);
      };
      currentWorker.onerror = (event) => {
        event.preventDefault();
        if (worker !== currentWorker) return;
        currentWorker.terminate();
        worker = null;
        finishAnalysis({ id: activeJob?.id, error: '棋力引擎加载失败' });
      };
    }
    worker.postMessage(activeJob);
    const id = activeJob.id;
    // 看门狗给足本次搜索预算，并留出引擎加载和消息传递的时间。
    jobTimer = setTimeout(() => {
      worker?.terminate();
      worker = null;
      finishAnalysis({ id, error: '棋力引擎响应超时' });
    }, activeJob.time + 15000);
  } catch {
    worker?.terminate();
    worker = null;
    finishAnalysis({ id: activeJob?.id, error: '无法启动棋力引擎' });
  }
}

function acceptCandidate({ id, index }) {
  const job = activeJob;
  if (job?.mode !== 'auto' || id !== job.id || id !== revision || suggestion
      || !Number.isInteger(index) || position.board[index] !== EMPTY) return;

  // 半秒内留住最新一轮的落点。设备较慢时，收到第一条完整路线就展示。
  job.candidate = index;
  clearTimeout(firstSuggestionTimer);
  const remaining = quickSearchMs - (performance.now() - job.startedAt);
  const showCandidate = () => {
    if (activeJob !== job || revision !== id || suggestion) return;
    suggestion = { index: job.candidate };
    render();
  };
  if (remaining <= 0) showCandidate();
  else firstSuggestionTimer = setTimeout(showCandidate, remaining);
}

function finishAnalysis(data) {
  if (!activeJob || data.id !== activeJob.id) return;
  const { mode } = activeJob;
  clearTimeout(jobTimer);
  clearTimeout(firstSuggestionTimer);
  activeJob = null;
  if (data.id === revision && !draft && !result) {
    if (data.error || position.board[data.index] !== EMPTY) {
      const modeName = mode === 'ultimate' ? '终极分析' : '深度分析';
      const message = suggestion ? modeName + '未完成，仍可采用当前推荐。' : '引擎暂时不可用，请重试。';
      analysisNotice = { mode: suggestion ? 'deep' : 'quick', message };
    } else if (game.mode === 'engine' && position.next !== game.player) {
      commit(data.index);
      return;
    } else {
      // 快算落点已可能被用户下到好友棋局里。深算异点单独给出，原记录按钮保持原坐标。
      const index = suggestion?.index ?? data.index;
      suggestion = {
        index,
        mode: mode === 'auto' ? 'deep' : mode,
        alternative: data.index === index ? null : data.index,
        hadPrevious: !!suggestion,
      };
    }
  }
  runNextJob();
  render();
}

function commit(index) {
  if (!Number.isInteger(index) || position.board[index] !== EMPTY || result || draft) return;
  updateGame({ ...game, moves: [...game.moves, index] });
}

function undo(length) {
  if (length === null || length >= game.moves.length) return;
  const nextGame = { ...game, moves: game.moves.slice(0, length) };
  // 逐手撤回引擎落子时先暂停，避免引擎立刻重复走刚被撤销的一手。
  updateGame(nextGame, { pause: game.mode === 'engine' && positionOf(nextGame).next !== game.player });
}

function choosePoint(index) {
  if (index === null) return;
  if (draft) {
    draft.board[index] = draft.tool;
    draft.uncertain = draft.uncertain.filter((point) => point !== index);
    if (!draft.fixedNext) draft.next = inferredNext(draft.board, draft.next);
    render();
    return;
  }
  if (result || (game.mode === 'engine' && position.next !== game.player)) return;
  if (position.board[index] !== EMPTY) {
    toast(coordinate(index) + ' 已有棋子');
    return;
  }
  selected = index;
  render();
}

function inferredNext(board, fallback) {
  const [, black, white] = counts(board);
  return black === white ? BLACK : black === white + 1 ? WHITE : fallback;
}

function startDraft(kind, options = {}) {
  const blank = kind === 'manual';
  const board = options.board || (blank ? blankBoard() : position.board.slice());
  const next = options.next ?? (blank ? BLACK : position.next);
  draft = {
    kind, board, next,
    player: options.player ?? game.player,
    mode: game.mode,
    tool: BLACK,
    fixedNext: kind === 'correct',
    reference: options.reference ?? (kind === 'correct' ? reference : null),
    uncertain: options.uncertain || [],
    needsAlignment: options.needsAlignment === true,
  };
  clearSelection();
  invalidateAnalysis();
  render();
}

function clearSelection() {
  selected = null;
  cursor = null;
}

function finishDraft() {
  if (!draft || draft.needsAlignment) return;
  const { board, next, player, mode } = draft;
  if (game.moves.length || game.initial.some(Boolean) || previous) previous = { game, reference };
  reference = draft.reference;
  draft = null;
  updateGame(createGame({ board, next, player, mode }));
}

function cancelDraft() {
  draft = null;
  invalidateAnalysis();
  scheduleAnalysis();
  render();
}

function tipFor(index) {
  if (findWinningMoves(position.board, position.next).includes(index)) return '这一步可直接连成五子。';
  if (findWinningMoves(position.board, opposite(position.next)).includes(index)) return '封住对方一个下一手成五的点。';
  return '在好友棋局落子后，回这里确认。';
}

function renderTurn() {
  const label = byId('turn-label');
  const title = byId('turn-title');
  const detail = byId('turn-detail');
  const currentJob = activeJob?.id === revision ? activeJob : nextJob;
  const thinking = !!currentJob;
  const ultimateRunning = currentJob?.mode === 'ultimate';
  const deepRunning = currentJob?.mode === 'deep' || currentJob?.mode === 'auto';
  const longRunning = ultimateRunning || deepRunning;
  const ultimateDone = suggestion?.mode === 'ultimate';
  const deepDone = suggestion?.mode === 'deep';
  const mine = position.next === game.player;
  const recordingFriend = game.mode === 'follow' && !mine;
  const hasSelected = selected !== null;
  label.textContent = result ? '本局结束' : colorName(position.next) + '落子';
  if (result) {
    title.textContent = result.winner ? colorName(result.winner) + '获胜' : '本局和棋';
    detail.textContent = result.winner ? '棋盘已标出连成的棋子。' : '棋盘已下满。';
  } else if (hasSelected) {
    title.textContent = (recordingFriend ? '好友落子 ' : '你的落子 ') + coordinate(selected);
    detail.textContent = game.mode === 'follow' ? '点其他交叉点可修改位置。' : '确认后，引擎会自动应手。';
  } else if (recordingFriend) {
    title.textContent = '选择好友的落子位置';
    detail.textContent = '点选棋盘上的交叉点，再确认记录。';
  } else if (suggestion && game.mode === 'follow') {
    const point = coordinate(suggestion.index);
    const reviewed = deepDone || ultimateDone;
    const confirmed = reviewed && suggestion.hadPrevious && suggestion.alternative === null;
    const prefix = confirmed ? '仍推荐 ' : '推荐 ';
    title.textContent = prefix + point;
    if (ultimateRunning) detail.textContent = '终极分析中 · ' + currentJob.time / 1000 + ' 秒预算，仍可采用当前推荐。';
    else if (deepRunning) detail.textContent = '正在深度分析，当前推荐仍可采用。';
    else if (analysisNotice) detail.textContent = analysisNotice.message;
    else if (suggestion.alternative != null) detail.textContent = '可以试选新建议，也可以记录原落点。';
    else if (ultimateDone) detail.textContent = '终极分析完成。' + tipFor(suggestion.index);
    else detail.textContent = tipFor(suggestion.index);
  } else if (analysisNotice) {
    title.textContent = '暂时无法分析';
    detail.textContent = analysisNotice.message;
  } else if (enginePaused) {
    title.textContent = '已暂停应手';
    detail.textContent = '可以继续悔棋，或恢复引擎应手。';
  } else if (game.mode === 'engine' && mine) {
    title.textContent = '轮到你了';
    detail.textContent = '在棋盘点选一个交叉点，确认落子。';
  } else {
    title.textContent = mine ? '分析下一手…' : '引擎思考中…';
    detail.textContent = mine ? '也可以先录入你的实际落点。' : '计算完成后会自动落子。';
  }
  const confirm = byId('confirm');
  confirm.hidden = !hasSelected;
  confirm.textContent = recordingFriend ? '确认好友落子' : game.mode === 'follow' ? '确认我的落子' : '确认落子';
  byId('cancel-preview').hidden = !hasSelected;
  confirm.parentElement.classList.toggle('has-preview', hasSelected);
  const adopt = byId('adopt');
  adopt.hidden = hasSelected || !suggestion || game.mode !== 'follow' || !!result;
  if (suggestion) adopt.textContent = '记录 ' + coordinate(suggestion.index);
  const alternative = byId('alternative');
  alternative.hidden = adopt.hidden || suggestion?.alternative == null;
  if (!alternative.hidden) {
    alternative.textContent = (ultimateDone ? '终极建议 ' : '深算建议 ') + coordinate(suggestion.alternative);
  }
  byId('turn-panel').classList.toggle('deep-running', longRunning && !hasSelected);
  const ultimate = byId('ultimate');
  ultimate.hidden = !suggestion || game.mode !== 'follow' || !!result || (!longRunning && hasSelected);
  ultimate.disabled = thinking && !longRunning;
  ultimate.textContent = longRunning ? '停止分析' : '终极分析';
  ultimate.setAttribute('aria-haspopup', longRunning ? 'false' : 'dialog');
  const deeper = byId('deeper');
  deeper.hidden = hasSelected || !!result || ultimateDone || !alternative.hidden
    || !(suggestion || analysisNotice || enginePaused);
  deeper.disabled = thinking || deepDone;
  deeper.setAttribute('aria-busy', String(deepRunning));
  if (ultimateRunning) deeper.textContent = '深度分析';
  else if (deepRunning) deeper.textContent = '分析中';
  else if (deepDone) deeper.textContent = '深算完成';
  else if (enginePaused) deeper.textContent = '引擎应手';
  else if (analysisNotice?.mode === 'deep') deeper.textContent = '重试深度分析';
  else if (analysisNotice?.mode === 'quick') deeper.textContent = '重试';
  else deeper.textContent = '深度分析';
}

function renderRecords() {
  const list = byId('moves');
  const count = game.moves.length;
  byId('record-count').textContent = count + ' 手';
  list.replaceChildren();
  let color = game.next;
  for (const [turn, index] of game.moves.entries()) {
    const item = document.createElement('li');
    const stone = document.createElement('i');
    stone.className = 'stone ' + (color === BLACK ? 'black' : 'white');
    item.title = '第 ' + (turn + 1) + ' 手 · ' + colorName(color);
    item.append(stone, coordinate(index));
    list.append(item);
    color = opposite(color);
  }
  if (count) list.scrollTop = list.scrollHeight;
  else {
    const item = document.createElement('li');
    item.className = 'empty-record';
    item.textContent = '确认落子后，记录会出现在这里。';
    list.append(item);
  }
  byId('undo').disabled = count === 0;
  byId('undo-round').hidden = game.mode !== 'engine';
  byId('undo-round').disabled = roundUndoLength(game) === null;
  byId('restore').hidden = !previous;
}

function renderBoard() {
  drawBoard(canvas, {
    board: draft?.board ?? position.board,
    last: draft ? undefined : position.last,
    selected: draft ? null : selected,
    recommended: !draft && game.mode === 'follow' ? suggestion?.index ?? null : null,
    next: position.next,
    line: draft ? [] : result?.line ?? [],
    cursor: document.activeElement === canvas && canvas.matches(':focus-visible') ? cursor : null,
    uncertain: draft?.uncertain ?? [],
  });
}

function renderDraft(black, white) {
  byId('edit-title').textContent = { manual: '手动摆盘', correct: '校正棋盘', image: '核对图片棋局', example: '核对示例棋局' }[draft.kind];
  byId('edit-detail').textContent = draft.kind === 'image'
    ? '对照原图，点棋盘修正识别结果。'
    : '点棋盘摆棋，设置下一手后继续。';
  byId('edit-next').value = draft.next;
  byId('edit-color').value = draft.player;
  byId('edit-mode').value = draft.mode;
  byId('save-edit').disabled = draft.needsAlignment;
  for (const button of byId('edit-tool').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.tool) === draft.tool));
  }
  const notes = [];
  if (draft.needsAlignment) notes.push('没有定位到网格，请手动选择四个外角。');
  if (draft.uncertain.length) notes.push('请核对棋盘上用橙色虚线圈出的点。');
  if (!draft.needsAlignment && !draft.board.some(Boolean) && draft.kind === 'image') notes.push('识别结果为空盘，请核对原图。');
  if (black !== white && black !== white + 1) notes.push('棋子数量不同于常规棋局，请核对后再继续。');
  byId('edit-note').textContent = notes.join(' ');
  byId('align').hidden = !draft.reference;
}

function render() {
  byId('play-controls').hidden = !!draft;
  byId('edit-controls').hidden = !draft;
  byId('record-card').hidden = !!draft;
  byId('upload').disabled = loadingImage;
  byId('setup').disabled = loadingImage;
  byId('correct').disabled = loadingImage;
  byId('upload').lastChild.textContent = loadingImage ? '正在识别…' : '导入截图';
  const [, black, white] = counts(draft?.board ?? position.board);
  byId('black-count').textContent = black;
  byId('white-count').textContent = white;
  byId('reference').hidden = !(draft ? draft.reference : reference);
  byId('example').hidden = !!draft || black + white > 0;
  if (draft) {
    renderDraft(black, white);
  } else {
    for (const button of byId('mode').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === game.mode));
    }
    for (const button of byId('play-color').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.color) === game.player));
    }
    renderTurn();
    renderRecords();
  }
  renderBoard();
}

function openPhoto(mode) {
  if (!(draft ? draft.reference : reference)) return;
  photoMode = mode;
  photoCorners = [];
  if (!photoDialog.open) photoDialog.showModal();
  renderPhoto();
}

function renderPhoto() {
  const original = draft ? draft.reference : reference;
  if (!original) return;
  const align = photoMode === 'align';
  const { image, corners } = original;
  photoCanvas.width = image.width;
  photoCanvas.height = image.height;
  const context = photoCanvas.getContext('2d');
  context.putImageData(image, 0, 0);
  const points = align ? photoCorners : corners ?? [];
  context.lineWidth = Math.max(2, image.width / 240);
  context.strokeStyle = '#238657';
  context.fillStyle = '#2a985f';
  if (points.length) {
    context.beginPath();
    points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
    if (points.length === 4) context.closePath();
    context.stroke();
    for (const [x, y] of points) {
      context.beginPath();
      context.arc(x, y, Math.max(4, image.width / 95), 0, Math.PI * 2);
      context.fill();
    }
  }
  if (!align && draft && corners) {
    // 仅在导入校正时，将识别出的棋子与原图叠加核对。
    const radius = Math.max(4, Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) / 45);
    draft.board.forEach((color, index) => {
      if (!color) return;
      const [x, y] = gridPoint(corners, Math.floor(index / SIZE), index % SIZE);
      context.strokeStyle = draft.uncertain.includes(index) ? '#ff9d42' : '#37bb78';
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.stroke();
    });
  }
  byId('photo-stage').classList.toggle('align', align);
  byId('photo-title').textContent = align ? '手动定位棋盘' : '原始截图';
  byId('photo-detail').textContent = align
    ? photoCorners.length < 4 ? '点击网格最外侧交叉点 · ' + cornerNames[photoCorners.length]
      : validCorners(photoCorners) ? '已选择四角，可以识别棋子。' : '四角顺序或位置有误，请重新选择。'
    : draft ? '绿圈表示已识别棋子，橙圈表示需要核对。' : '这是开始录入前的截图。';
  byId('reset-corners').hidden = !align;
  byId('apply-corners').hidden = !align;
  byId('apply-corners').disabled = !validCorners(photoCorners);
}

async function importPhoto(file) {
  if (!file || loadingImage) return;
  loadingImage = true;
  render();
  try {
    const image = await readImage(file);
    const corners = detectGrid(image);
    const found = corners ? identifyStones(image, corners) : { board: blankBoard(), uncertain: [] };
    const next = inferredNext(found.board, BLACK);
    startDraft('image', { ...found, next, player: next, reference: { image, corners }, needsAlignment: !corners });
    if (!corners) openPhoto('align');
  } catch {
    toast('无法读取这张图片，请换一张 JPG、PNG 或 WebP 截图。');
  } finally {
    loadingImage = false;
    render();
  }
}

byId('upload').addEventListener('click', () => byId('image-file').click());
byId('image-file').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  importPhoto(file);
});
byId('setup').addEventListener('click', () => startDraft('manual'));
byId('correct').addEventListener('click', () => startDraft('correct'));
byId('cancel-edit').addEventListener('click', cancelDraft);
byId('save-edit').addEventListener('click', finishDraft);
byId('clear-board').addEventListener('click', () => {
  draft.board = blankBoard();
  draft.next = BLACK;
  draft.fixedNext = false;
  draft.uncertain = [];
  draft.needsAlignment = false;
  render();
});
byId('edit-tool').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tool]');
  if (button && draft) { draft.tool = Number(button.dataset.tool); render(); }
});
byId('edit-next').addEventListener('change', (event) => {
  draft.next = Number(event.target.value);
  draft.fixedNext = true;
});
byId('edit-color').addEventListener('change', (event) => { draft.player = Number(event.target.value); });
byId('edit-mode').addEventListener('change', (event) => { draft.mode = event.target.value; });
byId('mode').addEventListener('click', (event) => {
  const mode = event.target.closest('[data-mode]')?.dataset.mode;
  if (mode && game.mode !== mode) {
    updateGame({ ...game, mode });
    toast('已切换为' + upper[mode]);
  }
});
byId('play-color').addEventListener('click', (event) => {
  const color = Number(event.target.closest('[data-color]')?.dataset.color);
  if (color && game.player !== color) updateGame({ ...game, player: color });
});
byId('confirm').addEventListener('click', () => commit(selected));
byId('cancel-preview').addEventListener('click', () => { clearSelection(); render(); });
byId('record-card').addEventListener('toggle', (event) => {
  if (!event.currentTarget.open) return;
  const list = byId('moves');
  list.scrollTop = list.scrollHeight;
});
byId('adopt').addEventListener('click', () => commit(suggestion?.index));
byId('alternative').addEventListener('click', () => {
  if (suggestion?.alternative != null) choosePoint(suggestion.alternative);
});
byId('deeper').addEventListener('click', () => {
  enginePaused = false;
  save();
  if (suggestion) scheduleAnalysis('deep');
  else scheduleAnalysis();
  render();
});
byId('ultimate').addEventListener('click', () => {
  if (activeJob && activeJob.mode !== 'quick') {
    stopActiveSearch();
    analysisNotice = { message: '已停止分析，仍可采用当前推荐。' };
    render();
  } else if (suggestion && selected === null && !ultimateDialog.open) {
    ultimateDialog.showModal();
  }
});
byId('ultimate-cancel').addEventListener('click', () => ultimateDialog.close());
byId('ultimate-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!ultimateSeconds.reportValidity()) return;
  ultimateDialog.close();
  scheduleAnalysis('ultimate', ultimateSeconds.valueAsNumber * 1000);
  render();
});
byId('undo').addEventListener('click', () => undo(game.moves.length - 1));
byId('undo-round').addEventListener('click', () => undo(roundUndoLength(game)));
byId('restore').addEventListener('click', () => {
  if (!previous) return;
  const target = previous;
  previous = { game, reference };
  reference = target.reference;
  updateGame(target.game);
});
byId('example').addEventListener('click', () => {
  const board = blankBoard();
  for (const [color, points] of [[BLACK, ['I7', 'J7', 'G8', 'H8', 'J8', 'I9']], [WHITE, ['G7', 'H7', 'I8', 'G9', 'H9']]]) {
    for (const point of points) board[(Number(point.slice(1)) - 1) * SIZE + point.charCodeAt(0) - 65] = color;
  }
  startDraft('example', { board, player: WHITE, next: WHITE });
});
byId('reference').addEventListener('click', () => openPhoto('review'));
byId('align').addEventListener('click', () => openPhoto('align'));
byId('close-photo').addEventListener('click', () => photoDialog.close());
byId('reset-corners').addEventListener('click', () => { photoCorners = []; renderPhoto(); });
byId('apply-corners').addEventListener('click', () => {
  if (!draft?.reference || !validCorners(photoCorners)) return;
  draft.reference = { ...draft.reference, corners: photoCorners.slice() };
  const found = identifyStones(draft.reference.image, photoCorners);
  draft.board = found.board;
  draft.uncertain = found.uncertain;
  draft.needsAlignment = false;
  if (!draft.fixedNext) draft.next = inferredNext(draft.board, draft.next);
  photoDialog.close();
  render();
});
photoCanvas.addEventListener('click', (event) => {
  if (photoMode !== 'align' || photoCorners.length === 4) return;
  const rect = photoCanvas.getBoundingClientRect();
  photoCorners.push([(event.clientX - rect.left) * photoCanvas.width / rect.width,
    (event.clientY - rect.top) * photoCanvas.height / rect.height]);
  renderPhoto();
});
canvas.addEventListener('click', (event) => {
  choosePoint(boardHit(canvas.getBoundingClientRect(), event.clientX, event.clientY));
});
canvas.addEventListener('keydown', (event) => {
  const shifts = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (!Object.hasOwn(shifts, event.key) && !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (cursor === null) cursor = SIZE * Math.floor(SIZE / 2) + Math.floor(SIZE / 2);
  if (shifts[event.key]) {
    const [dr, dc] = shifts[event.key];
    const clamp = (num) => Math.min(SIZE - 1, Math.max(0, num));
    cursor = clamp(Math.floor(cursor / SIZE) + dr) * SIZE + clamp(cursor % SIZE + dc);
    canvas.setAttribute('aria-label', '15 路棋盘，当前选点 ' + coordinate(cursor));
    renderBoard();
  } else {
    choosePoint(cursor);
  }
});
canvas.addEventListener('blur', renderBoard);
new ResizeObserver(renderBoard).observe(byId('board-frame'));

updateGame(game, { pause: enginePaused });
