// Local preview server (no dependencies): serves the site with the same headers
// as vercel.json and runs api/chat.js. Usage:
//   ANTHROPIC_API_KEY=... node scripts/dev-server.mjs   (or put it in .env.local)
// Then open http://localhost:3000
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Load .env.local if present (never committed).
const envFile = path.join(root, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const headers = vercel.headers.flatMap((r) => r.headers);
const { default: chat } = await import(pathToFileURL(path.join(root, 'api/chat.js')).href);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8'
};

async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '') || '/';
  const candidates = clean === '/' ? ['index.html'] : [clean.slice(1), clean.slice(1) + '.html', clean.slice(1) + '/index.html'];
  for (const c of candidates) {
    const full = path.join(root, c);
    if (!full.startsWith(root + path.sep)) continue;
    if (/(^|\/)(\.|node_modules|api\/|scripts\/)/.test(c)) continue;
    try {
      const s = await stat(full);
      if (s.isFile()) return full;
    } catch { /* try next */ }
  }
  return null;
}

const port = Number(process.env.PORT || 3000);
http
  .createServer(async (req, res) => {
    for (const h of headers) res.setHeader(h.key, h.value);
    if (req.url.split('?')[0] === '/api/chat') return chat(req, res);
    const file = await resolveFile(req.url);
    if (!file) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  })
  .listen(port, () => console.log(`Preview running at http://localhost:${port}`));
