/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ICAL_URL?: string;
  readonly VITE_WEATHER_CITY?: string;
  readonly VITE_WEATHER_STATE?: string;
  readonly VITE_BACKGROUND_IMAGE_URL?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_HOME_ADDRESS?: string;
  readonly VITE_COMMUTE?: string;
  readonly VITE_FINNHUB_API_KEY?: string;
  readonly VITE_TICKERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
