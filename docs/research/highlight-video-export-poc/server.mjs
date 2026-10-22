import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
export const resultsDir = path.join(root, '.cache/highlight-video-export-poc/results');
export async function startServer() {
  await fs.mkdir(resultsDir, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && /^\/save\/[a-z0-9-]+\.(mp4|png|json)$/.test(url.pathname)) {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) throw new Error('Research output too large');
          chunks.push(chunk);
        }
        await fs.writeFile(path.join(resultsDir, path.basename(url.pathname)), Buffer.concat(chunks));
        res.writeHead(200); res.end('saved'); return;
      }
      const files = {
        '/': [path.join(here, 'index.html'), 'text/html'],
        '/probe.mjs': [path.join(here, 'probe.mjs'), 'text/javascript'],
        '/timeline.mjs': [path.join(here, 'timeline.mjs'), 'text/javascript'],
        '/mediabunny.mjs': [path.join(root, '.cache/highlight-video-export-poc/mediabunny-1.62.1/dist/bundles/mediabunny.mjs'), 'text/javascript'],
      };
      if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = files[url.pathname];
      if (!file || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      res.end(await fs.readFile(file[0]));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
