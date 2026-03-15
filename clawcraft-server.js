const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const FRONTEND_DIR = path.join(process.env.HOME || '/home/claw', 'clawcraft', 'frontend');
const GATEWAY_PORT = 18789;
const SERVE_PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Proxy /clawcraft/* to Gateway
  if (url.startsWith('/clawcraft/')) {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: GATEWAY_PORT,
      path: url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${GATEWAY_PORT}` },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Gateway proxy failed: ${err.message}` }));
    });
    req.pipe(proxyReq);
    return;
  }

  // Serve static files
  let filePath = path.join(FRONTEND_DIR, url === '/' ? 'index.html' : url);
  
  // SPA fallback: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(FRONTEND_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(SERVE_PORT, '0.0.0.0', () => {
  console.log(`ClawCraft frontend server: http://0.0.0.0:${SERVE_PORT}`);
  console.log(`  Frontend: ${FRONTEND_DIR}`);
  console.log(`  API proxy: /clawcraft/* → localhost:${GATEWAY_PORT}`);
});
