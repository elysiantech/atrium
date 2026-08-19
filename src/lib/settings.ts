import { Preferences } from '@capacitor/preferences';
import { isNativeAndroid } from './native';

export type DisplaySettings = {
  intervalSeconds: number;
  brightness: number;
  showMeta: boolean;
  cropFill: boolean;
  fade: boolean;
  tickers: string[];
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  intervalSeconds: 60,
  brightness: 35,
  showMeta: false,
  cropFill: false,
  fade: true,
  tickers: [],
};

const SETTINGS_KEY = 'atrium.display-settings';
const SETTINGS_MIRROR_KEY = 'atrium.display-settings.mirror';

function normalizeSettings(value: Partial<DisplaySettings>): DisplaySettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    tickers: Array.isArray(value.tickers)
      ? value.tickers.filter((ticker): ticker is string => typeof ticker === 'string')
      : DEFAULT_SETTINGS.tickers,
  };
}

export function readCachedSettings(): DisplaySettings {
  try {
    const value = window.localStorage.getItem(SETTINGS_MIRROR_KEY);
    return value ? normalizeSettings(JSON.parse(value) as Partial<DisplaySettings>) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function fetchSettings(): Promise<DisplaySettings> {
  if (isNativeAndroid) {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    if (!value) return readCachedSettings();
    try {
      const settings = normalizeSettings(JSON.parse(value) as Partial<DisplaySettings>);
      window.localStorage.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(settings));
      return settings;
    } catch {
      return readCachedSettings();
    }
  }
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return DEFAULT_SETTINGS;
    return (await r.json()) as DisplaySettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<DisplaySettings>): Promise<DisplaySettings> {
  if (isNativeAndroid) {
    const current = await fetchSettings();
    const next = normalizeSettings({ ...current, ...patch });
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(next) });
    window.localStorage.setItem(SETTINGS_MIRROR_KEY, JSON.stringify(next));
    return next;
  }
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`settings ${r.status}`);
  return (await r.json()) as DisplaySettings;
}
