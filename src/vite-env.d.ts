/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ICAL_URL?: string;
  readonly VITE_OPENWEATHER_API_KEY?: string;
  readonly VITE_WEATHER_CITY?: string;
  readonly VITE_WEATHER_STATE?: string;
  readonly VITE_BACKGROUND_IMAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
