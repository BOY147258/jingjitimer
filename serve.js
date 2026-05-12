import http    from 'http';
import https   from 'https';
import fs      from 'fs';
import path    from 'path';
import os      from 'os';
import { fileURLToPath } from 'url';
import { handleAPI } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 8080;
const HTTPS_PORT= process.env.HTTPS_PORT || 8443;
const DIR       = __dirname;

// Try to load self-signed certs for HTTPS (local network camera access)
let tlsOptions = null;
try {
  tlsOptions = {
    key:  fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')),
  };
} catch { /* no certs — HTTP only */ }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4',
  '.ico':  'image/x-icon',
};

// ── SSE room management ─────────────────────────────────────────────────────
const rooms = new Map(); // roomCode → [{res, role, id}]
let   _nextId = 1;

function broadcast(roomCode, event, excludeId = null) {
  const clients = rooms.get(roomCode) || [];
  const msg     = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (c.id !== excludeId) {
      try { c.res.write(msg); } catch {}
    }
  }
}

// ── Request handler (shared by HTTP and HTTPS) ──────────────────────────────
async function handleRequest(req, res) {
  const urlObj  = new URL(req.url, 'http://x');
  const urlPath = urlObj.pathname;
  const params  = urlObj.searchParams;

  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── API ─────────────────────────────────────────────────────────────────
  if (urlPath.startsWith('/api/')) {
    return handleAPI(req, res);
  }

  // ── Clock sync ──────────────────────────────────────────────────────────
  if (urlPath === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ serverTime: Date.now() }));
    return;
  }

  // ── SSE stream ──────────────────────────────────────────────────────────
  if (urlPath === '/sse' && req.method === 'GET') {
    const room = params.get('room');
    const role = params.get('role') || 'unknown';

    if (!room) { res.writeHead(400); res.end('room required'); return; }

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.flushHeaders();

    const id     = _nextId++;
    const client = { res, role, id };
    if (!rooms.has(room)) rooms.set(room, []);
    rooms.get(room).push(client);

    const peers = rooms.get(room).filter(c => c.id !== id).map(c => c.role);
    res.write(`data: ${JSON.stringify({ type: 'JOINED', clientId: id, role, room, peers })}\n\n`);
    broadcast(room, { type: 'PEER_JOINED', role, clientId: id }, id);

    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      const arr = rooms.get(room);
      if (arr) {
        const idx = arr.findIndex(c => c.id === id);
        if (idx >= 0) arr.splice(idx, 1);
        if (arr.length === 0) rooms.delete(room);
      }
      broadcast(room, { type: 'PEER_LEFT', role, clientId: id });
    });

    console.log(`  [SSE] ${role}(${id}) joined room ${room}`);
    return;
  }

  // ── Event relay ─────────────────────────────────────────────────────────
  if (urlPath === '/relay' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { if (body.length < 8192) body += d; });
    req.on('end', () => {
      try {
        const { room, event, excludeSelf, clientId: cid } = JSON.parse(body);
        if (!room || !event) { res.writeHead(400); res.end('invalid'); return; }
        broadcast(room, event, excludeSelf ? (cid || null) : null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, serverTime: Date.now() }));
      } catch {
        res.writeHead(400); res.end('invalid json');
      }
    });
    return;
  }

  // ── Admin SPA fallback ──────────────────────────────────────────────────
  if (urlPath.startsWith('/admin') && !path.extname(urlPath)) {
    fs.readFile(path.join(DIR, 'admin.html'), (e, d) => {
      if (e) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(d);
    });
    return;
  }

  // ── Static files ────────────────────────────────────────────────────────
  let filePath = path.join(DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (readErr, data) => {
    if (readErr) {
      fs.readFile(path.join(DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(d2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache, no-store' });
    res.end(data);
  });
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const ip = getLocalIP();

if (tlsOptions) {
  // HTTPS server — camera/mic works on all browsers
  const httpsServer = https.createServer(tlsOptions, handleRequest);
  httpsServer.listen(HTTPS_PORT, () => {
    console.log('='.repeat(60));
    console.log('  竞迹 JingJi — 精准计时 · 智能田径');
    console.log('='.repeat(60));
    console.log(`  手机访问 (HTTPS): https://${ip}:${HTTPS_PORT}`);
    console.log(`  管理后台:         https://${ip}:${HTTPS_PORT}/admin`);
    console.log('');
    console.log('  首次访问提示"不安全" → 点"高级"→"继续访问"即可');
    console.log('  之后摄像头麦克风均正常可用');
    console.log('='.repeat(60));
  });

  // HTTP → redirect to HTTPS
  const httpRedirect = http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${ip}:${HTTPS_PORT}${req.url}` });
    res.end();
  });
  httpRedirect.listen(PORT);

} else {
  // No certs — HTTP fallback
  const httpServer = http.createServer(handleRequest);
  httpServer.listen(PORT, () => {
    console.log('='.repeat(56));
    console.log('  竞迹 JingJi (HTTP模式 — 摄像头不可用)');
    console.log('='.repeat(56));
    console.log(`  移动端:   http://${ip}:${PORT}`);
    console.log(`  管理后台: http://${ip}:${PORT}/admin`);
    console.log('='.repeat(56));
  });
}
