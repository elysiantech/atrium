# Atrium

A family wall dashboard. Renders a 7-day calendar (from a Google Calendar
iCal feed), current weather + 7-day forecast (Open-Meteo), live drive
times to configured destinations (Google Maps Routes API), and a
scrolling stock ticker (Finnhub).

## Android / ApolloSign

Atrium is also a self-contained Android kiosk app. Capacitor packages the
existing React/Vite interface into the APK, so there is no web server or
remote browser page to keep running. The Android layer supplies kiosk mode,
on-device settings, Google Photos authorization, Picker sessions, and a
private offline photo cache. The dashboard component and its pointer gestures
are shared unchanged with the browser build.

The Android application ID is `com.wmondesir.atrium`. It is locked to
landscape, keeps the display awake, and hides the system bars. Hold three
fingers for two seconds to open Atrium's Sources screen. Hold four fingers for
two seconds to leave kiosk mode and open Android Settings. These gestures are
observed without consuming the existing one-finger calendar and ticker drags.

For maintenance over an authorized ADB connection, open either screen directly:

```sh
adb shell am start -n com.wmondesir.atrium/.MainActivity --es atrium_path /connect
adb shell am start -n com.wmondesir.atrium/.MainActivity --es atrium_path /
```

### Build a signed APK

Prerequisites are Node/npm, JDK 21, and an Android SDK with API/build-tools 36.
The release keystore belongs at `secrets/atrium-release.jks` (ignored by Git).
Gradle reads its password from macOS Keychain account `atrium-build`, service
`com.wmondesir.atrium.signing`; the keystore and Keychain item must both be
backed up because future updates need the same signing identity.

```sh
npm install
npm run android:apk
```

The signed artifact is
`android/app/build/outputs/apk/release/app-release.apk`. Install or update the
paired ApolloSign with:

```sh
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

For Google Photos, create an Android OAuth client in the Google Cloud project
that owns the Photos Picker API. Set package name `com.wmondesir.atrium` and
register the SHA-1 fingerprint of the release certificate. No client secret is
embedded in the APK: Google Play services authorizes the package/signature pair
and manages short-lived access tokens. Atrium immediately downloads selections
into private app storage, so cached photos continue rotating when the Picker
session expires or the network is unavailable.

### Safe Google Photos workflow for a household display

Use a dedicated, otherwise empty Google account on ApolloSign rather than a
personal account. Android accounts are device-wide: adding a personal Google
account can also enable Gmail, Contacts, Calendar, and Chrome synchronization.

1. Add the dedicated account to Android and turn off every account-sync item.
2. In Atrium Sources, connect Google Photos and open the Picker.
3. Select the approved photos and tap Done. Returning to Atrium starts an
   awaited download; do not sign out until the green downloaded count appears.
4. If the automatic download does not start, tap **Download completed
   selection**.
5. Tap **Sign out · keep photos** to revoke Atrium's Google grant without
   deleting the private photo cache.
6. Remove the Google account from Android Settings if the device should be
   completely signed out. Cached photos continue rotating offline.

**Disconnect** is intentionally different: it revokes Google authorization and
deletes the downloaded photo cache.

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

All `VITE_*` env vars are inlined into the built web bundle, including the copy
inside the APK. Restrict API keys by API and, where supported, Android
package/signing certificate. Do not commit `.env`, the release keystore, cached
photos, or OAuth material.
