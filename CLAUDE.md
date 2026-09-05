# CLAUDE.md — Atrium

Family wall dashboard. Two deploy targets share one React/Vite codebase:
the browser build served by `server.ts`, and a Capacitor Android kiosk APK
that runs on the ApolloSign display. Read `README.md` for the full user-facing
setup; this file holds the operational knowledge an agent needs to build and
ship without asking.

## Repo map

| Path | What it is |
|---|---|
| `src/App.tsx` | Dashboard: calendar, weather, commute, ticker, photo slideshow |
| `src/pages/Connect.tsx` | Sources screen (`/connect`): Google Photos auth and picker |
| `src/lib/*.ts` | One module per data source: calendar (iCal), weather (Open-Meteo), traffic (Google Routes), stocks (Finnhub quote endpoint only, no history), photo, settings, native bridge |
| `server.ts` | Node server for the browser deploy: static `dist/`, iCal proxy, Google Photos OAuth + Picker + on-disk photo cache, settings API |
| `android/` | Capacitor Android project. `AtriumNativePlugin.java` and `MainActivity.java` supply kiosk mode, gestures, Google Photos on device |
| `deploy/com.atrium.plist` | launchd template for the always-on-Mac browser deploy |
| `docs/photos-slideshow.md` | Design history for the photo pipeline. Decision: on-disk cache is the core, sources are importers |

## Commands

```sh
npm install
npm run dev          # Vite on :5173
npm run build        # tsc -b && vite build -> dist/
npm start            # node server.ts serving dist/ (browser deploy)
npm run android:apk  # build web, cap sync, gradlew assembleRelease (signed)
```

Signed APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
Always run `npm run build` (which runs tsc) before committing.

## Toolchain the build machine must have

- Node 22.6 or newer. `server.ts` runs with `--experimental-strip-types`.
- JDK 21 (`brew install openjdk@21`; set `JAVA_HOME` or symlink into `/Library/Java/JavaVirtualMachines`).
- Android SDK: platform `android-36`, `build-tools;36.0.0`, `platform-tools`.
  On macOS via Homebrew: `brew install --cask android-commandlinetools android-platform-tools`,
  then `sdkmanager "platforms;android-36" "build-tools;36.0.0"` and accept licenses.
- `android/local.properties` is gitignored. Create it with `sdk.dir=<absolute SDK path>`
  (Homebrew path is `/opt/homebrew/share/android-commandlinetools`).
- Gradle itself comes from the wrapper (`gradlew`), no install needed.

## Secrets and untracked files (never commit; copy by hand between machines)

| File | Purpose |
|---|---|
| `.env` | All `VITE_*` keys plus `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Template in `.env.example` |
| `secrets/atrium-release.jks` | Release keystore, alias `atrium`. Losing it means the ApolloSign can never take an update again. Back it up |
| `secrets/gphotos.json` | Refresh token + picker session for the server-side Google Photos flow |
| `settings.json` | Runtime slideshow settings written by the settings API |
| `cache/` | Downloaded photos for the browser deploy. Optional to copy; re-import refills it |

Signing password: Gradle reads `ATRIUM_SIGNING_PASSWORD` from the environment
first, then falls back to the macOS Keychain item (account `atrium-build`,
service `com.wmondesir.atrium.signing`). To seed Keychain on a new Mac:

```sh
security add-generic-password -a atrium-build -s com.wmondesir.atrium.signing -w '<password>' -U
```

All `VITE_*` values are inlined into the bundle and the APK. Keys are
restricted per API in Google Cloud; the Android OAuth client is bound to
package `com.wmondesir.atrium` plus the release certificate SHA-1, so a
different keystore also breaks Google Photos on the device.

## Deploying to the ApolloSign

The display is an Android device paired over ADB. Confirm it is visible first:

```sh
adb devices -l
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

If it is not listed, connect over the LAN with `adb connect <sign-ip>:5555`
(or wireless-debugging pairing) before installing. Bump `versionCode` in
`android/app/build.gradle` on every release that ships to the device.

Maintenance shortcuts once installed:

```sh
adb shell am start -n com.wmondesir.atrium/.MainActivity --es atrium_path /connect
adb shell am start -n com.wmondesir.atrium/.MainActivity --es atrium_path /
```

Gestures on the device: three-finger hold for two seconds opens Sources;
four-finger hold for two seconds exits kiosk to Android Settings.

## Browser deploy (always-on Mac)

Follow README "Deploying as a background service". Restart after any `.env`
change: `launchctl unload`, `npm run build`, `launchctl load`. Logs in
`/tmp/atrium.log` and `/tmp/atrium.err.log`.

## Conventions

- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- No emojis in UI, code, commits, or docs.
- Production code keeps error logs only.
- Do not add tracking or state where a one-shot emit will do.
- Google Photos: the Picker session and testing-mode refresh token each expire
  after 7 days. This is expected. Display never depends on them because photos
  are cached to disk at import time.
