import { BLACK, EMPTY, SIZE, WHITE, blankBoard } from './game.js';

// 按截图自身尺寸取像素，不传输原图，限制工作图尺寸以控制手机端内存。
export async function readImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / image.naturalWidth, 3200 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function lineScores(image, horizontal, from, to, offset, stride) {
  const length = horizontal ? image.height : image.width;
  const scores = new Float32Array(length);
  const step = horizontal ? image.width * 4 : 4;
  const advance = horizontal ? 4 : image.width * 4;
  const shift = offset * step;
  const sampleCount = Math.floor((to - from) / stride) + 1;
  const { data } = image;
  for (let line = offset; line < length - offset; line++) {
    let hits = 0;
    for (let i = from; i <= to; i += stride) {
      const pos = line * step + i * advance + 1;
      if (Math.min(data[pos - shift], data[pos + shift]) - data[pos] >= 20) hits++;
    }
    scores[line] = hits / sampleCount;
  }
  return scores;
}

// 同时寻找 15 条等距的线。广告、文字和棋盘边框里偶然出现的孤线分数不够。
function fitAxis(scores, minStep, maxStep) {
  let best = null;
  for (let start = 0; start + (SIZE - 1) * minStep < scores.length; start++) {
    if (scores[start] < .28) continue;
    for (let step = minStep; step <= maxStep; step += .25) {
      const end = Math.round(start + (SIZE - 1) * step);
      if (end >= scores.length || Math.max(scores[end], scores[end - 1], scores[end + 1] ?? 0) < .25) continue;
      let score = 0;
      let strong = 0;
      for (let line = 0; line < SIZE; line++) {
        const at = Math.round(start + line * step);
        const value = Math.max(scores[at], (scores[at - 1] ?? 0) * .97, (scores[at + 1] ?? 0) * .97);
        score += value;
        if (value >= .25) strong++;
      }
      if (strong >= 13 && score >= 7.5 && (!best || score > best.score)) {
        best = { start, end: start + (SIZE - 1) * step, step, score };
      }
    }
  }
  return best;
}

export function detectGrid(image) {
  const short = Math.min(image.width, image.height);
  if (short < 170) return null;
  const offset = Math.max(3, Math.round(short * .0048));
  const stride = Math.max(3, Math.round(short * .007));
  const minStep = Math.max(8, short * .037);
  const maxStep = short / (SIZE - 1);
  const xInset = Math.round(image.width * .065);
  const xSampleWidth = Math.min(image.width - 2 * xInset, short);
  const xFrom = Math.floor((image.width - xSampleWidth) / 2);
  const rows = fitAxis(lineScores(image, true, xFrom, xFrom + xSampleWidth - 1, offset, stride),
    minStep, maxStep);
  if (!rows) return null;
  const cols = fitAxis(lineScores(image, false, Math.ceil(rows.start + offset), Math.floor(rows.end - offset),
    offset, stride), rows.step * .95, rows.step * 1.05);
  if (!cols) return null;
  return [
    [cols.start, rows.start], [cols.end, rows.start],
    [cols.end, rows.end], [cols.start, rows.end],
  ];
}

export function validCorners(corners) {
  // 四个点必须顺时针围成凸四边形，防止手动选反导致棋盘变形。
  return corners.length === 4 && corners.every(([x, y], index) => {
    const [nx, ny] = corners[(index + 1) % 4];
    const [tx, ty] = corners[(index + 2) % 4];
    return Math.hypot(nx - x, ny - y) >= 45
      && (nx - x) * (ty - ny) - (ny - y) * (tx - nx) > 250;
  });
}

export function gridPoint(corners, row, col) {
  const [a, b, c, d] = corners;
  const u = col / (SIZE - 1);
  const v = row / (SIZE - 1);
  return a.map((value, axis) => (1 - v) * ((1 - u) * value + u * b[axis])
    + v * ((1 - u) * d[axis] + u * c[axis]));
}

const ring = [.16, .21, .26, .3].flatMap((radius) => Array.from({ length: 24 }, (_, index) => {
  const angle = 2 * Math.PI * index / 24;
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}));

export function identifyStones(image, corners) {
  const board = blankBoard();
  const uncertain = [];
  const { data, width, height } = image;
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      let dark = 0;
      let light = 0;
      // 避开中心光圈，在棋子内侧多半径取样，星位和网格线只覆盖少量像素。
      const [x, y] = gridPoint(corners, row, col);
      const [xCol, yCol] = gridPoint(corners, row, col + 1);
      const [xRow, yRow] = gridPoint(corners, row + 1, col);
      for (const [dr, dc] of ring) {
        const px = Math.round(x + (xCol - x) * dc + (xRow - x) * dr);
        const py = Math.round(y + (yCol - y) * dc + (yRow - y) * dr);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const at = (py * width + px) * 4;
        const min = Math.min(data[at], data[at + 1], data[at + 2]);
        const max = Math.max(data[at], data[at + 1], data[at + 2]);
        if (max < 100) dark++;
        if (min > 155 && max - min < 35) light++;
      }
      const index = row * SIZE + col;
      const strongest = Math.max(dark, light) / ring.length;
      board[index] = strongest < .6 ? EMPTY : dark > light ? BLACK : WHITE;
      if (strongest >= .3 && strongest < .67) uncertain.push(index);
    }
  }
  return { board, uncertain };
}
