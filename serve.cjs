const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const { stat } = require('node:fs/promises');
const { extname, resolve, sep } = require('node:path');

const root = __dirname;
const port = Number(process.argv[2] || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

// 仅用于本地预览。只提供项目目录内的网页和引擎资源。
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const part = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(root, '.' + part);
    if (!file.startsWith(root + sep) || !/^\/(?:[^/.][^/]*\.(?:html|css|js)|vendor\/rapfi\/[^/]+)$/.test(part)) {
      response.writeHead(404).end();
      return;
    }
    const details = await stat(file);
    if (!details.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Content-Length': details.size,
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log('棋间预览：http://127.0.0.1:' + port + '/');
});
