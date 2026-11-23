import { BLACK, SIZE, WHITE, columnOf, rowOf } from './game.js';

// 绘制和命中检测使用同一套交叉点坐标，避免缩放后点击偏移。
export function boardGeometry(size) {
  const margin = size * .073;
  const step = (size - 2 * margin) / (SIZE - 1);
  return { margin, step };
}

export function boardHit(rect, clientX, clientY) {
  const { margin, step } = boardGeometry(rect.width);
  const x = (clientX - rect.left - margin) / step;
  const y = (clientY - rect.top - margin) / step;
  const col = Math.round(x);
  const row = Math.round(y);
  return col < 0 || col >= SIZE || row < 0 || row >= SIZE ? null : row * SIZE + col;
}

export function drawBoard(canvas, { board, last, selected, recommended, next, line, cursor, uncertain }) {
  const { width } = canvas.getBoundingClientRect();
  if (!width) return;
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const pixels = Math.round(width * ratio);
  if (canvas.width !== pixels || canvas.height !== pixels) canvas.width = canvas.height = pixels;
  const context = canvas.getContext('2d');
  context.setTransform(pixels / width, 0, 0, pixels / width, 0, 0);
  const { margin, step } = boardGeometry(width);
  const start = margin;
  const end = margin + (SIZE - 1) * step;
  const point = (index) => [start + columnOf(index) * step, start + rowOf(index) * step];
  const circle = (x, y, r) => {
    context.beginPath();
    context.arc(x, y, r, 0, 2 * Math.PI);
  };

  const wood = context.createLinearGradient(0, 0, width, width);
  wood.addColorStop(0, '#f0d5ae');
  wood.addColorStop(.65, '#e9c797');
  wood.addColorStop(1, '#e3bd8c');
  context.fillStyle = wood;
  context.fillRect(0, 0, width, width);
  context.strokeStyle = '#6945229e';
  context.lineWidth = Math.max(.65, width / 640);
  context.beginPath();
  for (let i = 0; i < SIZE; i++) {
    const offset = start + i * step;
    context.moveTo(start, offset);
    context.lineTo(end, offset);
    context.moveTo(offset, start);
    context.lineTo(offset, end);
  }
  context.stroke();
  context.strokeStyle = '#684624c4';
  context.strokeRect(start, start, end - start, end - start);
  context.fillStyle = '#79502f';
  for (const index of [48, 56, 112, 168, 176]) {
    circle(...point(index), Math.max(1.8, step * .075));
    context.fill();
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '600 ' + Math.max(9, Math.min(12, step * .32)) + 'px Inter, system-ui, sans-serif';
  context.fillStyle = '#765735';
  for (let i = 0; i < SIZE; i++) {
    context.fillText(String.fromCharCode(65 + i), start + i * step, start * .47);
    context.fillText(String(i + 1), start * .46, start + i * step);
  }

  function drawStone(index, color, faded = false) {
    const [x, y] = point(index);
    const radius = step * .44;
    const gradient = context.createRadialGradient(x - radius * .32, y - radius * .42,
      radius * .08, x, y, radius);
    gradient.addColorStop(0, color === BLACK ? '#51574d' : '#ffffff');
    gradient.addColorStop(1, color === BLACK ? '#222722' : '#e7e3d7');
    context.save();
    context.globalAlpha = faded ? .54 : 1;
    context.shadowColor = '#3d2c2a4a';
    context.shadowBlur = Math.max(1, step * .10);
    context.shadowOffsetY = step * .045;
    circle(x, y, radius);
    context.fillStyle = gradient;
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = color === BLACK ? '#1f2420' : '#b1a895';
    context.lineWidth = Math.max(.65, step * .026);
    context.stroke();
    context.restore();
  }

  function ring(index, color, dashed) {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Math.max(1.8, step * .068);
    if (dashed) context.setLineDash([step * .14, step * .10]);
    circle(...point(index), step * .44);
    context.stroke();
    context.restore();
  }

  board.forEach((color, index) => { if (color) drawStone(index, color); });
  for (const index of uncertain) ring(index, '#9c6017', true);
  if (last !== undefined) {
    context.fillStyle = board[last] === WHITE ? '#41604e' : '#e3c295';
    circle(...point(last), Math.max(1.9, step * .088));
    context.fill();
  }
  line.forEach((index) => ring(index, '#4c8059', false));
  if (recommended !== null && recommended !== selected) ring(recommended, '#275a43', true);
  if (selected !== null) {
    drawStone(selected, next, true);
    ring(selected, '#285f47', false);
  }
  if (cursor !== null && cursor !== selected) ring(cursor, '#6f583e', true);
}
