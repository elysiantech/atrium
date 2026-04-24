// Unified server: serves dist/ and exposes /api/* for:
//   /api/photos            → list of picked media IDs
//   /api/photos/:id        → cache-first: on miss, fetches from Google, caches, streams
//   /api/ical              → proxy to VITE_ICAL_URL
//   /api/sources           → source status
//   /api/sources/gphotos/* → OAuth, pick, disconnect, session
//
// Cache is read-through: images populate as the display requests them. No
// bulk import step. If Google is unavailable, cached images still serve.

import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, VITE_ICAL_URL } = process.env;
const PORT = Number(process.env.PORT ?? 5173);
const CACHE_DIR = resolve(process.env.ATRIUM_CACHE_DIR ?? 'cache');
const PHOTOS_DIR = join(CACHE_DIR, 'photos');
const MANIFEST_FILE = join(CACHE_DIR, 'manifest.json');
const SECRETS_FILE = 'secrets/gphotos.json';
const SETTINGS_FILE = process.env.ATRIUM_SETTINGS_FILE ?? 'settings.json';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

mkdirSync(PHOTOS_DIR, { recursive: true });
mkdirSync('secrets', { recursive: true });

// ─── Store ───────────────────────────────────────────────────────────────────
type Store = { refresh_token?: string; session_id?: string; session_expires_at?: string; last_sync_at?: string };
function readStore(): Store {
  if (!existsSync(SECRETS_FILE)) return {};
  try { return JSON.parse(readFileSync(SECRETS_FILE, 'utf8')); } catch { return {}; }
}
function writeStore(s: Store): void {
  writeFileSync(SECRETS_FILE, JSON.stringify(s, null, 2));
}

// ─── Manifest (the list of picked IDs + mime) ────────────────────────────────
type ManifestItem = { id: string; mime: string; filename?: string };
type Manifest = { sessionId: string; updatedAt: string; items: ManifestItem[] };
function readManifest(): Manifest {
  if (!existsSync(MANIFEST_FILE)) return { sessionId: '', updatedAt: '', items: [] };
  try { return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { return { sessionId: '', updatedAt: '', items: [] }; }
}
function writeManifest(m: Manifest): void {
  const tmp = MANIFEST_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(m, null, 2));
  renameSync(tmp, MANIFEST_FILE);
}

// ─── Display settings ────────────────────────────────────────────────────────
type Settings = {
  intervalSeconds: number;
  brightness: number; // 0–100; higher = brighter image (less overlay)
  showMeta: boolean;
  cropFill: boolean; // true = cover, false = contain
  fade: boolean;
};
const DEFAULT_SETTINGS: Settings = {
  intervalSeconds: 60,
  brightness: 35,
  showMeta: false,
  cropFill: true,
  fade: true,
};
function readSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return { ...DEFAULT_SETTINGS, ...s };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(s: Settings): void {
  const tmp = SETTINGS_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, SETTINGS_FILE);
}

// ─── Google Photos client ────────────────────────────────────────────────────
let accessToken: string | null = null;
let accessExpiry = 0;

async function getAccessToken(): Promise<string> {
  const store = readStore();
  if (!store.refresh_token) throw new Error('not connected');
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

type MediaItem = { id: string; mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string } };

async function createPickerSession(access: string): Promise<{ id: string; pickerUri: string; expireTime?: string }> {
  const r = await fetch('https://photospicker.googleapis.com/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(`create session: ${r.status} ${await r.text()}`);
  return (await r.json()) as { id: string; pickerUri: string; expireTime?: string };
}

async function getPickerSession(id: string, access: string): Promise<{ mediaItemsSet?: boolean; expireTime?: string }> {
  const r = await fetch(`https://photospicker.googleapis.com/v1/sessions/${id}`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!r.ok) throw new Error(`get session: ${r.status} ${await r.text()}`);
  return (await r.json()) as { mediaItemsSet?: boolean; expireTime?: string };
}

async function listMediaItems(sessionId: string, access: string): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL('https://photospicker.googleapis.com/v1/mediaItems');
    u.searchParams.set('sessionId', sessionId);
    u.searchParams.set('pageSize', '100');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${access}` } });
    if (!r.ok) throw new Error(`list: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { mediaItems?: MediaItem[]; nextPageToken?: string };
    items.push(...(j.mediaItems ?? []));
    pageToken = j.nextPageToken;
  } while (pageToken);
  return items.filter((i) => i.mediaFile?.mimeType?.startsWith('image/') && i.mediaFile?.baseUrl);
}

async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch { /* best effort */ }
}

// ─── Media cache (in-memory: id → current baseUrl) ───────────────────────────
// baseUrls expire every ~60 min, so we refresh periodically.
let mediaMap: Map<string, MediaItem> = new Map();
let mediaExpiry = 0;
let lastSessionId = '';
let refreshingMedia: Promise<void> | null = null;

async function refreshMediaMap(sessionId: string): Promise<void> {
  const access = await getAccessToken();
  const items = await listMediaItems(sessionId, access);
  mediaMap = new Map(items.map((i) => [i.id, i]));
  mediaExpiry = Date.now() + 45 * 60_000;
  lastSessionId = sessionId;

  // Reconcile manifest + cache against the current picker session.
  const prev = readManifest();
  const prevIds = new Set(prev.items.map((i) => i.id));
  const nextIds = new Set(items.map((i) => i.id));

  const manifest: Manifest = {
    sessionId,
    updatedAt: new Date().toISOString(),
    items: items.map((i) => ({
      id: i.id,
      mime: i.mediaFile?.mimeType ?? 'image/jpeg',
      filename: i.mediaFile?.filename,
    })),
  };
  writeManifest(manifest);

  // Evict cached files no longer picked.
  if (prev.sessionId && prev.sessionId !== sessionId) {
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        try { unlinkSync(join(PHOTOS_DIR, id)); } catch { /* ignore */ }
      }
    }
  }

  const s = readStore();
  s.last_sync_at = manifest.updatedAt;
  writeStore(s);
  console.log(`[photos] session ${sessionId.slice(0, 8)}… → ${items.length} items`);
}

async function ensureMediaFresh(): Promise<void> {
  const store = readStore();
  if (!store.session_id) throw new Error('no picker session');
  const fresh = mediaMap.size > 0 && Date.now() < mediaExpiry && lastSessionId === store.session_id;
  if (fresh) return;
  if (refreshingMedia) return refreshingMedia;
  refreshingMedia = (async () => {
    try {
      const access = await getAccessToken();
      const session = await getPickerSession(store.session_id!, access);
      if (!session.mediaItemsSet) throw new Error('picker session not finalized — finish picking, then retry');
      await refreshMediaMap(store.session_id!);
    } finally {
      refreshingMedia = null;
    }
  })();
  return refreshingMedia;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
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

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirectUri(): string {
  return `http://127.0.0.1:${PORT}/api/sources/gphotos/oauth/callback`;
}

function cachePath(id: string): string {
  return join(PHOTOS_DIR, id);
}

function countCached(): number {
  try { return readdirSync(PHOTOS_DIR).length; } catch { return 0; }
}

async function serveCached(res: ServerResponse, id: string, mime: string): Promise<boolean> {
  const file = cachePath(id);
  if (!existsSync(file)) return false;
  const st = statSync(file);
  res.writeHead(200, {
    'content-type': mime,
    'content-length': st.size,
    'cache-control': 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
  return true;
}

async function fetchAndCache(id: string, item: MediaItem): Promise<Buffer> {
  if (!item.mediaFile?.baseUrl) throw new Error('no baseUrl');
  const access = await getAccessToken();
  const url = `${item.mediaFile.baseUrl}=w2560-h1440`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
  if (!r.ok) throw new Error(`download ${id}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(cachePath(id), buf);
  return buf;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const { pathname } = url;

  try {
    if (pathname === '/api/photos') {
      // Refresh manifest from Google if we have a session (non-blocking
      // beyond first call; falls through to stale manifest on failure).
      const store = readStore();
      if (store.session_id) {
        try { await ensureMediaFresh(); } catch (e) { console.warn('[photos] refresh:', e instanceof Error ? e.message : e); }
      }
      const m = readManifest();
      return json(res, 200, {
        ids: m.items.map((i) => i.id),
        meta: Object.fromEntries(m.items.map((i) => [i.id, { filename: i.filename ?? null }])),
      });
    }

    if (pathname.startsWith('/api/photos/')) {
      const id = decodeURIComponent(pathname.slice('/api/photos/'.length));
      const m = readManifest();
      const meta = m.items.find((i) => i.id === id);
      if (!meta) { res.writeHead(404).end(); return; }

      // Cache hit.
      if (await serveCached(res, id, meta.mime)) return;

      // Cache miss — try Google.
      try {
        await ensureMediaFresh();
        const item = mediaMap.get(id);
        if (!item) { res.writeHead(404).end(); return; }
        const buf = await fetchAndCache(id, item);
        res.writeHead(200, {
          'content-type': meta.mime,
          'content-length': buf.length,
          'cache-control': 'public, max-age=3600',
        });
        res.end(buf);
      } catch (e) {
        console.warn('[photos] miss+fetch failed:', id.slice(0, 8), e instanceof Error ? e.message : e);
        res.writeHead(502).end();
      }
      return;
    }

    if (pathname === '/api/ical') {
      if (!VITE_ICAL_URL) { res.writeHead(404).end('no ical configured'); return; }
      const r = await fetch(VITE_ICAL_URL);
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/calendar' });
      await streamResponseBody(r, res);
      return;
    }

    if (pathname === '/api/sources') {
      const store = readStore();
      const m = readManifest();
      return json(res, 200, {
        gphotos: {
          connected: Boolean(store.refresh_token),
          hasSession: Boolean(store.session_id),
          sessionExpiresAt: store.session_expires_at ?? null,
          lastSyncAt: store.last_sync_at ?? null,
          pickedCount: m.items.length,
          cachedCount: countCached(),
        },
      });
    }

    if (pathname === '/api/sources/gphotos/oauth/start') {
      const returnTo = url.searchParams.get('returnTo') ?? '/connect';
      const state = Buffer.from(JSON.stringify({ returnTo })).toString('base64url');
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.searchParams.set('client_id', GOOGLE_CLIENT_ID!);
      auth.searchParams.set('redirect_uri', redirectUri());
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly');
      auth.searchParams.set('access_type', 'offline');
      auth.searchParams.set('prompt', 'consent');
      auth.searchParams.set('state', state);
      res.writeHead(302, { location: auth.toString() });
      res.end();
      return;
    }

    if (pathname === '/api/sources/gphotos/oauth/callback') {
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      const stateRaw = url.searchParams.get('state') ?? '';
      let returnTo = '/connect';
      try {
        const s = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
        if (typeof s.returnTo === 'string') returnTo = s.returnTo;
      } catch { /* ignore */ }

      const redirectBack = (params: Record<string, string>) => {
        const u = new URL(returnTo, `http://127.0.0.1:${PORT}`);
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
        res.writeHead(302, { location: u.toString() });
        res.end();
      };

      if (err || !code) {
        redirectBack({ oauth: 'error', msg: err ?? 'no code' });
        return;
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID!,
          client_secret: GOOGLE_CLIENT_SECRET!,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        redirectBack({ oauth: 'error', msg: `token exchange ${tokenRes.status}: ${body.slice(0, 200)}` });
        return;
      }
      const tok = (await tokenRes.json()) as { refresh_token?: string };
      if (!tok.refresh_token) {
        redirectBack({ oauth: 'error', msg: 'no refresh_token returned (revoke app access at myaccount.google.com and retry)' });
        return;
      }
      const s = readStore();
      s.refresh_token = tok.refresh_token;
      writeStore(s);
      accessToken = null;
      accessExpiry = 0;
      redirectBack({ oauth: 'ok' });
      return;
    }

    if (pathname === '/api/sources/gphotos/pick' && req.method === 'POST') {
      const access = await getAccessToken();
      const sess = await createPickerSession(access);
      const s = readStore();
      s.session_id = sess.id;
      s.session_expires_at = sess.expireTime;
      writeStore(s);
      // New session invalidates our media map.
      mediaMap = new Map();
      mediaExpiry = 0;
      lastSessionId = '';
      return json(res, 200, { pickerUri: sess.pickerUri, sessionId: sess.id, expiresAt: sess.expireTime ?? null });
    }

    if (pathname === '/api/sources/gphotos/session') {
      const store = readStore();
      if (!store.session_id) return json(res, 200, { hasSession: false });
      try {
        const access = await getAccessToken();
        const s = await getPickerSession(store.session_id, access);
        return json(res, 200, { hasSession: true, mediaItemsSet: Boolean(s.mediaItemsSet), expiresAt: s.expireTime ?? null });
      } catch (e) {
        return json(res, 200, { hasSession: true, mediaItemsSet: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (pathname === '/api/settings') {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        let patch: Partial<Settings> = {};
        try { patch = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* ignore */ }
        const next: Settings = { ...readSettings(), ...patch };
        // clamp / validate
        next.intervalSeconds = Math.max(10, Math.min(3600, Number(next.intervalSeconds) || DEFAULT_SETTINGS.intervalSeconds));
        next.brightness = Math.max(0, Math.min(100, Number(next.brightness) ?? DEFAULT_SETTINGS.brightness));
        next.showMeta = Boolean(next.showMeta);
        next.cropFill = Boolean(next.cropFill);
        next.fade = Boolean(next.fade);
        writeSettings(next);
        return json(res, 200, next);
      }
      return json(res, 200, readSettings());
    }

    if (pathname === '/api/sources/gphotos/disconnect' && req.method === 'POST') {
      const store = readStore();
      if (store.refresh_token) await revokeToken(store.refresh_token);
      try { unlinkSync(SECRETS_FILE); } catch { /* ignore */ }
      for (const name of readdirSync(PHOTOS_DIR)) {
        try { unlinkSync(join(PHOTOS_DIR, name)); } catch { /* ignore */ }
      }
      try { unlinkSync(MANIFEST_FILE); } catch { /* ignore */ }
      accessToken = null;
      accessExpiry = 0;
      mediaMap = new Map();
      mediaExpiry = 0;
      lastSessionId = '';
      return json(res, 200, { ok: true });
    }

    res.writeHead(404).end();
  } catch (e) {
    console.error('[api]', pathname, e);
    json(res, 500, { error: e instanceof Error ? e.message : 'server error' });
  }
}

// ─── Static ──────────────────────────────────────────────────────────────────
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
    handleApi(req, res, url).catch((e) => {
      console.error('[api]', e);
      res.writeHead(500).end(e instanceof Error ? e.message : 'server error');
    });
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  const m = readManifest();
  const store = readStore();
  console.log(`atrium server on :${PORT}`);
  console.log(`  cache: ${PHOTOS_DIR} (${countCached()} cached / ${m.items.length} picked)`);
  console.log(`  gphotos: ${store.refresh_token ? 'connected' : 'not connected'}`);
});
