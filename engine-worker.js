/* global Rapfi */
importScripts('./vendor/rapfi/rapfi-single.js');

let response = null;
let progress = null;
const ready = Rapfi({
  locateFile: (name) => new URL(name.endsWith('.data') ? 'rapfi.data'
    : name.endsWith('.wasm') ? 'rapfi-single.wasm' : name,
    new URL('./vendor/rapfi/', self.location.href)).href,
  onReceiveStdout(line) {
    if (!response || !line) return;
    const point = /^(\d+),(\d+)$/.exec(line);
    if (point) response.index = Number(point[2]) * 15 + Number(point[1]);
    if (line.startsWith('ERROR ')) response.error = line.slice(6);
    if (line.startsWith('MESSAGE Bestline ')) response.line = line.slice(17).trim().split(/\s+/);
    if (progress) readSearchProgress(line);
  },
  onReceiveStderr: (line) => { if (line) console.warn('棋力引擎：', line); },
});

function readSearchProgress(line) {
  // 只接收首选路线，等 Rapfi 报告该轮完整输出后再发送，跳过正在试算的落点。
  if (line === 'INFO PV 0') {
    progress.reading = true;
    progress.index = null;
  } else if (progress.reading && line.startsWith('INFO BESTLINE ')) {
    const point = /^INFO BESTLINE (\d+),(\d+)(?:\s|$)/.exec(line);
    if (!point) return;
    const col = Number(point[1]);
    const row = Number(point[2]);
    const index = row * 15 + col;
    if (col < 15 && row < 15 && progress.board[index] === 0) progress.index = index;
  } else if (line.startsWith('INFO PV ')) {
    if (line === 'INFO PV DONE' && progress.reading && progress.index !== null) {
      self.postMessage({ id: progress.id, type: 'candidate', index: progress.index });
    }
    progress.reading = false;
  }
}

function boardCommand(board, moves, next) {
  // 摆盘只知道各棋子的位置。尽量交替录入，随后按真实顺序录入已记录的落子。
  const recorded = new Set(moves);
  const black = [];
  const white = [];
  for (const [index, color] of board.entries()) {
    if (color && !recorded.has(index)) (color === 1 ? black : white).push(index);
  }
  const order = [];
  for (let i = 0; i < Math.max(black.length, white.length); i++) {
    if (i < black.length) order.push(black[i]);
    if (i < white.length) order.push(white[i]);
  }
  order.push(...moves);
  if (!order.length && next === 1) return 'BEGIN';

  const stones = order.map((index) =>
    [index % 15, Math.floor(index / 15), board[index] === next ? 1 : 2].join(','));
  // Rapfi 以第一手确定黑方，以最后一手的对方为待落子方。摆盘轮次需要时显式传入跳过的一手。
  if (board[order[0]] === 2) stones.unshift('-1,-1,' + (next === 1 ? 1 : 2));
  if (!order.length || board[order.at(-1)] === next) stones.push('-1,-1,2');
  return 'BOARD ' + stones.join(' ') + ' DONE';
}

self.onmessage = async ({ data: { id, board, moves = [], next, time, mode } }) => {
  try {
    const engine = await ready;
    response = {};
    engine.sendCommand('START 15');
    engine.sendCommand('INFO RULE 0');
    engine.sendCommand('INFO MAX_MEMORY 33554432');
    engine.sendCommand('INFO TIMEOUT_MATCH 0');
    engine.sendCommand('INFO TIMEOUT_TURN ' + time);
    engine.sendCommand('INFO TIME_LEFT 0');
    // 重用引擎时每次都设置详细输出，避免影响人机自动应手。
    engine.sendCommand('INFO SHOW_DETAIL ' + (mode === 'auto' ? 2 : 0));
    if (mode === 'auto') progress = { id, board, reading: false, index: null };
    engine.sendCommand(boardCommand(board, moves, next));
    if (!Number.isInteger(response.index) || board[response.index] !== 0) {
      throw new Error(response.error || '引擎没有返回可用的落点');
    }
    self.postMessage({ id, ...response });
  } catch (error) {
    self.postMessage({ id, error: error.message || '棋力引擎启动失败' });
  } finally {
    progress = null;
    response = null;
  }
};
