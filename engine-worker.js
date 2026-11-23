/* global Rapfi */
importScripts('./vendor/rapfi/rapfi-single.js');

let response = null;
const ready = Rapfi({
  locateFile: (name) => new URL(name.endsWith('.data') ? 'rapfi.data' : name,
    new URL('./vendor/rapfi/', self.location.href)).href,
  onReceiveStdout(line) {
    if (!response || !line) return;
    const point = /^(\d+),(\d+)$/.exec(line);
    if (point) response.index = Number(point[2]) * 15 + Number(point[1]);
    if (line.startsWith('ERROR ')) response.error = line.slice(6);
    if (line.startsWith('MESSAGE Bestline ')) response.line = line.slice(17).trim().split(/\s+/);
  },
  onReceiveStderr: (line) => { if (line) console.warn('棋力引擎：', line); },
});

self.onmessage = async ({ data: { id, board, next, time } }) => {
  try {
    const engine = await ready;
    response = {};
    engine.sendCommand('START 15');
    engine.sendCommand('INFO RULE 0');
    engine.sendCommand('INFO MAX_MEMORY 33554432');
    engine.sendCommand('INFO TIMEOUT_MATCH 0');
    engine.sendCommand('INFO TIMEOUT_TURN ' + time);
    engine.sendCommand('INFO TIME_LEFT 0');
    const stones = [];
    for (const [index, color] of board.entries()) {
      // BOARD 以当前计算方为 1，在自由规则下双方棋子的规则相同。
      if (color) stones.push([index % 15, Math.floor(index / 15), color === next ? 1 : 2].join(','));
    }
    engine.sendCommand(stones.length ? 'BOARD ' + stones.join(' ') + ' DONE' : 'BEGIN');
    if (!Number.isInteger(response.index) || board[response.index] !== 0) {
      throw new Error(response.error || '引擎没有返回可用的落点');
    }
    self.postMessage({ id, ...response });
  } catch (error) {
    self.postMessage({ id, error: error.message || '棋力引擎启动失败' });
  } finally {
    response = null;
  }
};
