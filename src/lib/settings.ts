export type DisplaySettings = {
  intervalSeconds: number;
  brightness: number;
  showMeta: boolean;
  cropFill: boolean;
  fade: boolean;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  intervalSeconds: 60,
  brightness: 35,
  showMeta: false,
  cropFill: true,
  fade: true,
};

export async function fetchSettings(): Promise<DisplaySettings> {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return DEFAULT_SETTINGS;
    return (await r.json()) as DisplaySettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(patch: Partial<DisplaySettings>): Promise<DisplaySettings> {
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`settings ${r.status}`);
  return (await r.json()) as DisplaySettings;
}
