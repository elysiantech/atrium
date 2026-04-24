# Photos slideshow — design notes

Status as of commit `cd7b034`. Decision pending.

## What currently works (Google Photos Picker API)

- `scripts/gphotos.ts` runs one-time: OAuth on localhost callback, creates a
  picker session, user picks photos, stores `refresh_token` + `session_id` in
  `secrets/gphotos.json` (gitignored).
- `server.ts` at runtime:
  - refreshes the 1-hour OAuth access token on demand via the stored refresh
    token
  - re-polls `mediaItems.list` every 45 min to get fresh `baseUrl`s (which
    expire every 60 min)
  - streams each image at `/api/photos/:id` with the bearer token injected
    server-side (baseUrls are not directly browsable)
- `src/App.tsx` fetches the ID list, shuffles, rotates background every 60s
  with a next-image preload to avoid flash.

Verified: 744 images picked, end-to-end render in the browser works.

## The blocker: two separate 7-day limits

1. **Refresh token** — OAuth app is in "testing" mode, so Google rotates
   refresh tokens after 7 days. Next refresh call returns `invalid_grant`.
2. **Picker session** — Google's Picker API caps sessions at 7 days by
   design. After that, `mediaItems.list` returns 4xx.

Neither is a token-handling bug; both are policy caps. The current server has
no graceful handling — it just starts serving errors when either expires.

## Options

### A. iCloud Shared Album
- No auth. No OAuth. No expiry. Stable protocol since ~2015.
- Family drops photos from iPhones → auto-appear. Best UX for a family
  dashboard.
- Code: fetch shared album JSON, resolve derivative URLs, same rotation logic.
- Tradeoff: requires creating a shared album once; only Apple-family-friendly.

### B. Google Drive folder (not Photos)
- Use Drive API on a specific folder. Files don't expire. No session concept.
- Refresh tokens still 7-day in testing mode — fixed by publishing the app.
  Drive is a "sensitive" scope but Google verification is generally faster/more
  forgiving than Photos. ~2-4 weeks, but then works forever.
- Tradeoff: photos don't sync to Drive automatically; upload flow is manual
  or via rclone.

### C. Local folder on the mini
- Photos sit on disk at e.g. `~/apps/atrium/photos/`. Server lists + rotates.
- Zero auth, zero network, zero expiry. Cannot break.
- Tradeoff: someone (user, Dropbox/iCloud Drive sync, scp) has to get photos
  onto the mini.

### D. Stay on Google Photos Picker
- Requires weekly re-run of `scripts/gphotos.ts` forever (or build the
  /connect page below to make it a click instead of a CLI session).
- Even with /connect page: still need a human to click Reconnect weekly.

### E. Picker + on-disk cache (Picker becomes import-only)
- After picking, download all selected images to `cache/photos/<id>.jpg` on
  the mini. `server.ts` serves from disk, never from Google in the hot path.
- The two 7-day expiries stop mattering for display: nothing at runtime
  talks to Google. Refresh token + picker session only matter when the user
  wants to re-import (add/remove photos).
- Re-pick cadence becomes "whenever family wants new photos in the rotation"
  — soft, ignorable. Not a 7-day cliff.
- Cost: ~400MB-1.5GB on disk for ~750 images. Trivial for a Mac mini.
- Tradeoff: no auto-sync. Photos added to the source album after the import
  don't appear until the next re-import. (Picker has never had auto-sync —
  it's a one-shot selection — so this isn't a regression.)

## If we stay on Picker: the /connect page refactor

Moving OAuth + pick out of a CLI script and into the dashboard itself.
Required because the current script assumes laptop-side browser and loopback
port — neither works on the mini for a family member to re-auth themselves.

Architecture:
- Server routes:
  - `GET /connect/google` → redirect to Google OAuth with fixed
    redirect_uri (e.g. `http://wieners-mac-mini.local:5173/api/oauth/google/callback`)
    — this URI must be registered in Google Cloud Console
  - `GET /api/oauth/google/callback` → exchange code, save refresh_token
  - `POST /connect/photos/pick` → create picker session, return pickerUri
  - `GET /api/connections` → report status: connected?, session expires in X
- Small admin page in the React app (e.g. `/settings` or a gear-icon modal):
  - "Google Photos: Connected as wmondesir@gmail.com, session expires in 3 days"
  - "[Reconnect]" button → `/connect/google`
  - "[Re-pick album]" button → `/connect/photos/pick`, opens pickerUri in a
    new tab, polls session status
- `server.ts` changes: when the refresh call or mediaItems call returns a
  token/session error, set an in-memory `needsReconnect = true` flag. Admin
  page surfaces it. Dashboard keeps showing last-known photos (cached or
  fallback) until reconnect happens.

This is ~150 lines of server code + a small settings UI. Still doesn't remove
the 7-day cadence — just makes it a 20-second click from any browser
instead of SSH-into-mini + CLI.

## Direction (2026-04-23)

Reframe: **on-disk cache is the core**, sources are pluggable importers
that fill the cache. Display only ever reads from cache.

```
[Source plugins]              [Cache]              [Display]
Google Picker  ──┐
iCloud Album   ──┼──> import ──> cache/photos/  ──> /api/photos
Local folder   ──┤                (id.jpg + manifest.json)
Drive folder   ──┘
```

Why this shape:
- Removes the runtime fragility of every option above (E for Picker, but
  also future Drive/iCloud — none of them touch the hot path).
- Makes the source choice reversible. Switching from Picker to iCloud later
  doesn't touch `server.ts` photo routes or `App.tsx` rotation; it just
  swaps which importer fills `cache/photos/`.
- Cache is also useful for non-photo media we might add later (artwork,
  family event flyers, etc.) — same primitive.

### Control plane: `/connect` page

A web UI on the dashboard itself, reachable from any browser on the LAN, to
manage sources without SSH or CLI:

- "Add a source" → pick type (Google Picker / iCloud Shared Album / local
  folder / etc.), run the source-specific setup flow (OAuth + picker for
  Google; URL paste for iCloud; path picker for local).
- Per-source state: connected? last import? N images? next auto-refresh?
- Per-source actions: re-import now, disconnect, set auto-refresh cadence.
- Multiple sources can coexist — cache is the union, display rotates the
  union shuffled.

This is the path that lets "go grab photos from any source" stay open as a
future-you decision rather than a re-architecture.

### Near-term pick

Start with **E (Picker + cache)** because:
- The OAuth + picker code is already written and verified end-to-end.
- It immediately solves the 7-day cliff for display.
- The cache layer it forces us to build is the same cache that future
  sources will use — not throwaway work.

Defer the `/connect` page until a second source actually shows up to
justify it. Until then, re-import via `scripts/gphotos.ts` is fine — it's
soft cadence now, not a 7-day deadline.

### Earlier options, kept for reference

- **A (iCloud Shared Album)** — still the only auto-sync path. Worth
  revisiting if family wants drop-from-iPhone-and-it-appears UX. Plugs into
  the source-plugin model cleanly.
- **B (Drive)** — only worth it if Google app verification happens for
  some other reason; upload UX is bad for a family dashboard.
- **C (local folder)** — degenerate case of the cache itself. Could be
  exposed as a "local folder" source plugin trivially.
- **D (stay on Picker, no cache)** — superseded by E. The /connect page
  refactor sketched below is still relevant, but as part of the source
  control plane, not as a Picker-specific weekly-reconnect button.

## Revert path

If we pivot off Picker entirely (no longer relevant under E, but kept for
the case where Picker gets dropped later in favor of iCloud or other):
- `scripts/gphotos.ts`
- OAuth + session logic in `server.ts` (keep the static-file + iCal routes;
  replace photo routes)
- `secrets/gphotos.json`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from `.env`

`src/lib/photo.ts` and `src/App.tsx` rotation logic stay — same `/api/photos`
+ `/api/photos/:id` contract, new implementation behind it. Under the
cache-as-core direction, the contract is satisfied by reading `cache/photos/`
regardless of which importer filled it.
