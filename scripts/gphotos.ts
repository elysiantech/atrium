// Google Photos Picker smoke test + session setup.
//
// Prereq: Google Cloud project with Photos Picker API enabled, OAuth client
// of type "Desktop app". Put client_id/secret in .env:
//   GOOGLE_CLIENT_ID=...
//   GOOGLE_CLIENT_SECRET=...
//
// Run:
//   node --env-file=.env --experimental-strip-types scripts/gphotos.ts
//
// First run: OAuth in browser + picker flow on phone. Saves refresh_token
// and session_id to secrets/gphotos.json.
// Subsequent runs: refreshes access, re-lists items with fresh baseUrls.

import http from 'node:http';
import { exec } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  process.exit(1);
}

const STORE_FILE = 'secrets/gphotos.json';
const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
mkdirSync('secrets', { recursive: true });

type Store = { refresh_token?: string; session_id?: string };
const store: Store = existsSync(STORE_FILE)
  ? JSON.parse(readFileSync(STORE_FILE, 'utf8'))
  : {};
const save = () => writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));

function doOAuth(): Promise<string> {
  return new Promise((resolve, reject) => {
    let port = 0;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url!, `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.end(code ? 'Authorized. You can close this tab.' : `OAuth error: ${err ?? 'no code'}`);
      server.close();
      if (!code) return reject(new Error(err ?? 'no code'));
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: CLIENT_ID!,
            client_secret: CLIENT_SECRET!,
            redirect_uri: `http://127.0.0.1:${port}/callback`,
            grant_type: 'authorization_code',
          }),
        });
        if (!r.ok) throw new Error(`token exchange: ${r.status} ${await r.text()}`);
        const j = (await r.json()) as { refresh_token?: string };
        if (!j.refresh_token) throw new Error('no refresh_token (try revoking app and retrying)');
        resolve(j.refresh_token);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      const url = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: CLIENT_ID!,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
      });
      console.log(`Opening browser for Google login...\n  ${url}\n`);
      exec(`open "${url}"`);
    });
  });
}

async function getAccessToken(refresh: string): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`refresh: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function createSession(access: string): Promise<{ id: string; pickerUri: string }> {
  const r = await fetch('https://photospicker.googleapis.com/v1/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) throw new Error(`session: ${r.status} ${await r.text()}`);
  return (await r.json()) as { id: string; pickerUri: string };
}

async function pollSession(id: string, access: string): Promise<void> {
  process.stdout.write('Waiting for you to finish picking');
  for (;;) {
    const r = await fetch(`https://photospicker.googleapis.com/v1/sessions/${id}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!r.ok) throw new Error(`poll: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as { mediaItemsSet?: boolean };
    if (j.mediaItemsSet) {
      process.stdout.write(' ✓\n');
      return;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 3000));
  }
}

type MediaItem = {
  id: string;
  mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
};

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
  return items;
}

if (!store.refresh_token) {
  console.log('First run — Google OAuth...');
  store.refresh_token = await doOAuth();
  save();
  console.log('✓ refresh_token saved\n');
}

const access = await getAccessToken(store.refresh_token);
console.log('✓ access token');

if (!store.session_id) {
  console.log('Creating picker session...');
  const s = await createSession(access);
  store.session_id = s.id;
  save();
  console.log(`\nOpen this URL on your PHONE (or laptop) signed into Google Photos:\n  ${s.pickerUri}\n`);
  exec(`open "${s.pickerUri}"`);
  await pollSession(s.id, access);
}

const items = await listMediaItems(store.session_id, access);
const photos = items.filter((i) => i.mediaFile?.mimeType?.startsWith('image/'));
console.log(`\n${items.length} items picked (${photos.length} images):`);
for (const it of photos.slice(0, 5)) {
  console.log(`  ${it.mediaFile?.filename ?? '(unnamed)'}`);
  console.log(`    ${it.mediaFile?.baseUrl}=w1920-h1080`);
}
if (photos.length > 5) console.log(`  ... and ${photos.length - 5} more`);
