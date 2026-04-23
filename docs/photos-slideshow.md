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

## Recommendation

Given the stated requirement ("no babysitting every 7 days"): **iCloud
Shared Album (A)** or **local folder (C)**.

- If family is Apple-heavy and you want auto-sync → A.
- If you want zero external dependencies and are OK dropping photos onto the
  mini manually → C.

B (Drive) only makes sense if you're willing to go through Google app
verification; even then, upload flow is awkward for a family dashboard.

D (stay on Picker) is a poor fit for the requirement regardless of how
polished the /connect page is, because the 7-day re-pick is fundamental to
the API.

## Revert path

If we pivot off Picker, the code to remove:
- `scripts/gphotos.ts`
- OAuth + session logic in `server.ts` (keep the static-file + iCal routes;
  replace photo routes)
- `secrets/gphotos.json`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from `.env`

`src/lib/photo.ts` and `src/App.tsx` rotation logic stay — same `/api/photos`
+ `/api/photos/:id` contract, new implementation behind it.
