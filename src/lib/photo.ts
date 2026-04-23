const FALLBACK =
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1600&q=80';

export function getBackgroundImage(): string {
  return import.meta.env.VITE_BACKGROUND_IMAGE_URL || FALLBACK;
}

export async function fetchPhotoIds(): Promise<string[]> {
  try {
    const r = await fetch('/api/photos');
    if (!r.ok) return [];
    const j = (await r.json()) as { ids: string[] };
    const ids = [...j.ids];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  } catch {
    return [];
  }
}

export function photoUrl(id: string): string {
  return `/api/photos/${encodeURIComponent(id)}`;
}
