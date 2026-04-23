# Atrium

A family wall dashboard. Renders a 7-day calendar (from a Google Calendar
iCal feed), current weather + 7-day forecast (Open-Meteo), live drive
times to configured destinations (Google Maps Routes API), and a
scrolling stock ticker (Finnhub).

## Local development

```sh
npm install
cp .env.example .env
# fill in VITE_ICAL_URL, VITE_GOOGLE_MAPS_API_KEY, VITE_FINNHUB_API_KEY,
# VITE_HOME_ADDRESS, VITE_COMMUTE, VITE_TICKERS
npm run dev
```

Open http://localhost:5173.

## Production build

```sh
npm run build    # emits dist/
npm start        # serves dist/ on :5173 with the iCal proxy wired in
```

`npm start` is an alias for `vite preview`, which honors the preview
proxy config in `vite.config.ts` (same `/api/ical` rewrite used in dev).

## Deploying as a background service on macOS

Target: Mac Mini (or any always-on Mac). The app runs under `launchd`,
which starts it at login and restarts it if it crashes.

### 1. Clone and build

```sh
cd ~/apps                                        # or wherever you want it
git clone <repo-url> atrium
cd atrium
npm install
cp .env.example .env                             # then fill in keys
npm run build
```

### 2. Install the launchd plist

The plist template lives at `deploy/com.atrium.plist`. It has one
placeholder (`__WORKING_DIRECTORY__`) that needs to be replaced with the
absolute path to the repo on this machine, then copied into
`~/Library/LaunchAgents/`.

```sh
# from inside the repo root
APP_DIR="$(pwd)"
sed "s|__WORKING_DIRECTORY__|$APP_DIR|" deploy/com.atrium.plist \
  > ~/Library/LaunchAgents/com.atrium.plist

launchctl load ~/Library/LaunchAgents/com.atrium.plist
```

### 3. Verify

```sh
launchctl list | grep atrium              # should show the job with a PID
curl -sI http://localhost:5173 | head -1  # should return HTTP/1.1 200 OK
tail -f /tmp/atrium.log                   # live app logs
tail -f /tmp/atrium.err.log               # errors
```

From any other device on the LAN:
`http://<this-machine-hostname>.local:5173`

### 4. Managing the service

```sh
# stop
launchctl unload ~/Library/LaunchAgents/com.atrium.plist

# start
launchctl load ~/Library/LaunchAgents/com.atrium.plist

# restart (after code or .env changes)
launchctl unload ~/Library/LaunchAgents/com.atrium.plist
npm run build
launchctl load ~/Library/LaunchAgents/com.atrium.plist
```

`.env` changes require a full unload/load cycle because Vite reads env
vars at startup.

## Environment variables

All prefixed `VITE_` — documented in `.env.example`.

| Variable | What it is |
|---|---|
| `VITE_ICAL_URL` | Private iCal URL from Google Calendar → Settings → Integrate |
| `VITE_WEATHER_CITY` / `VITE_WEATHER_STATE` | Location (Open-Meteo geocodes this) |
| `VITE_BACKGROUND_IMAGE_URL` | Optional; overrides the default Unsplash background |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Cloud project with Routes API enabled + billing on |
| `VITE_HOME_ADDRESS` | Origin for drive-time calculations |
| `VITE_COMMUTE` | `Label\|Address\|\|Label\|Address` — destinations for drive times |
| `VITE_FINNHUB_API_KEY` | Free tier at https://finnhub.io |
| `VITE_TICKERS` | Comma-separated ticker symbols for the bottom ticker |

## Security note

All `VITE_*` env vars are inlined into the built client bundle. The app
is designed to be served **on your LAN only** — do not deploy it to a
public URL with these keys baked in.
