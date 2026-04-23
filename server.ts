// Unified server: serves dist/ and exposes /api/* for:
//   /api/photos         → list of media IDs (pre-shuffled is client's choice)
//   /api/photos/:id     → streams the image with auth injected server-side
//   /api/ical           → proxy to VITE_ICAL_URL (replaces vite's dev proxy in prod)
//
// Run:
//   npm run build           # emits dist/
//   npm start               # this file, on :5173

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, VITE_ICAL_URL } = process.env;
const PORT = Number(process.env.PORT ?? 5173);

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

type Store = { refresh_token: string; session_id: string };
let store: Store;
try {
  store = JSON.parse(readFileSync('secrets/gphotos.json', 'utf8'));
  if (!store.refresh_token || !store.session_id) throw new Error('incomplete');
} catch {
  console.error('secrets/gphotos.json missing or incomplete — run scripts/gphotos.ts first');
  process.exit(1);
}

let accessToken: string | null = null;
let accessExpiry = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessExpiry - 60_000) return accessToken;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID!,
      client_secret: GOOGLE_CLIENT_SECRET!,
      refresh_token: store.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token refresh ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  accessToken = j.access_token;
  accessExpiry = Date.now() + j.expires_in * 1000;
  return accessToken;
}

type MediaItem = {
  id: string;
  mediaFile?: { baseUrl: string; mimeType: string; filename?: string };
};
let mediaItems: MediaItem[] = [];
let mediaExpiry = 0;

async function refreshMedia(): Promise<void> {
  const access = await getAccessToken();
  const items: MediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL('https://photospicker.googleapis.com/v1/mediaItems');
    u.searchParams.set('sessionId', store.session_id);
    u.searchParams.set('pageSize', '100');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${access}` } });
    if (!r.ok) throw new Error(`list ${r.status}: ${await r.text()}`);
    const j = (await r.json()) as { mediaItems?: MediaItem[]; nextPageToken?: string };
    items.push(...(j.mediaItems ?? []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  mediaItems = items.filter((i) => i.mediaFile?.mimeType?.startsWith('image/'));
  mediaExpiry = Date.now() + 45 * 60_000;
  console.log(`[photos] refreshed ${mediaItems.length} images`);
}

async function getMedia(): Promise<MediaItem[]> {
  if (mediaItems.length === 0 || Date.now() >= mediaExpiry) {
    await refreshMedia();
  }
  return mediaItems;
}

async function streamResponseBody(r: Response, res: ServerResponse): Promise<void> {
  if (!r.body) { res.end(); return; }
  const reader = r.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  try {
    if (pathname === '/api/photos') {
      const media = await getMedia();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ids: media.map((m) => m.id) }));
      return;
    }

    if (pathname.startsWith('/api/photos/')) {
      const id = decodeURIComponent(pathname.slice('/api/photos/'.length));
      const media = await getMedia();
      const item = media.find((m) => m.id === id);
      if (!item?.mediaFile?.baseUrl) { res.writeHead(404).end(); return; }
      const access = await getAccessToken();
      const url = `${item.mediaFile.baseUrl}=w2560-h1440`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
      if (!r.ok) { res.writeHead(r.status).end(); return; }
      res.writeHead(200, {
        'content-type': r.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'public, max-age=1800',
      });
      await streamResponseBody(r, res);
      return;
    }

    if (pathname === '/api/ical') {
      if (!VITE_ICAL_URL) { res.writeHead(404).end('no ical configured'); return; }
      const r = await fetch(VITE_ICAL_URL);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/calendar' });
      await streamResponseBody(r, res);
      return;
    }

    res.writeHead(404).end();
  } catch (e) {
    console.error('[api]', e);
    res.writeHead(500).end(e instanceof Error ? e.message : 'server error');
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const DIST = resolve('dist');

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url!, 'http://x');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = resolve(DIST, '.' + rel);
  if (!full.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const st = statSync(full);
    if (st.isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
    });
    createReadStream(full).pipe(res);
  } catch {
    // SPA fallback
    try {
      const index = join(DIST, 'index.html');
      const st = statSync(index);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': st.size });
      createReadStream(index).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url.pathname);
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`atrium server on :${PORT}`);
  refreshMedia().catch((e) => console.error('[photos] initial refresh failed:', e));
});
