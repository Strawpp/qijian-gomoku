export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const opposite = (color) => color === BLACK ? WHITE : BLACK;
export const colorName = (color) => color === BLACK ? '黑棋' : '白棋';
export const indexOf = (row, col) => row * SIZE + col;
export const columnOf = (index) => index % SIZE;
export const rowOf = (index) => Math.floor(index / SIZE);
export const coordinate = (index) => String.fromCharCode(65 + columnOf(index)) + (rowOf(index) + 1);
export const blankBoard = () => Array(SIZE * SIZE).fill(EMPTY);

export function counts(board) {
  return board.reduce((total, color) => {
    total[color]++;
    return total;
  }, [0, 0, 0]);
}

export function createGame({ board = blankBoard(), next = BLACK, player = BLACK, mode = 'follow' } = {}) {
  return { initial: board.slice(), next, player, mode, moves: [] };
}

export function positionOf(game) {
  const board = game.initial.slice();
  let next = game.next;
  for (const index of game.moves) {
    board[index] = next;
    next = opposite(next);
  }
  return { board, next, last: game.moves.at(-1) };
}

// 自由规则下，任一方向连续五颗或更多同色棋子即获胜。
export function winningLine(board, index, color = board[index]) {
  if (!color || !Number.isInteger(index)) return [];
  const row = rowOf(index);
  const col = columnOf(index);
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [index];
    for (const sign of [-1, 1]) {
      for (let step = 1; step < SIZE; step++) {
        const r = row + sign * step * dr;
        const c = col + sign * step * dc;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[indexOf(r, c)] !== color) break;
        line.push(indexOf(r, c));
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}

export function outcomeOf(board, last) {
  if (last !== undefined) {
    const line = winningLine(board, last);
    if (line.length) return { winner: board[last], line };
  } else {
    for (let index = 0; index < board.length; index++) {
      const line = winningLine(board, index);
      if (line.length) return { winner: board[index], line };
    }
  }
  return board.includes(EMPTY) ? null : { winner: EMPTY, line: [] };
}

export function findWinningMoves(board, color) {
  return board.flatMap((cell, index) => !cell && winningLine(board, index, color).length ? [index] : []);
}

// 悔一轮回到最近一步玩家落子之前。只有引擎开局时保留逐手撤销。
export function roundUndoLength(game) {
  let color = positionOf(game).next;
  for (let length = game.moves.length - 1; length >= 0; length--) {
    color = opposite(color);
    if (color === game.player) return length;
  }
  return null;
}

export function validGame(game) {
  if (!game || !Array.isArray(game.initial) || game.initial.length !== SIZE * SIZE
      || !game.initial.every((cell) => [EMPTY, BLACK, WHITE].includes(cell))
      || ![BLACK, WHITE].includes(game.next) || ![BLACK, WHITE].includes(game.player)
      || !['follow', 'engine'].includes(game.mode) || !Array.isArray(game.moves)) return false;
  const occupied = new Set(game.initial.flatMap((cell, index) => cell ? [index] : []));
  for (const index of game.moves) {
    if (!Number.isInteger(index) || index < 0 || index >= SIZE * SIZE || occupied.has(index)) return false;
    occupied.add(index);
  }
  return true;
}
