const FALLBACK =
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1600&q=80';

export type PhotoMeta = { filename: string | null };

export function getBackgroundImage(): string {
  return import.meta.env.VITE_BACKGROUND_IMAGE_URL || FALLBACK;
}

export async function fetchPhotos(): Promise<{ ids: string[]; meta: Record<string, PhotoMeta> }> {
  try {
    const r = await fetch('/api/photos');
    if (!r.ok) return { ids: [], meta: {} };
    const j = (await r.json()) as { ids: string[]; meta?: Record<string, PhotoMeta> };
    const ids = [...j.ids];
    for (let i = ids.length - 1; i > 0; i--) {
      const k = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[k]] = [ids[k], ids[i]];
    }
    return { ids, meta: j.meta ?? {} };
  } catch {
    return { ids: [], meta: {} };
  }
}

export function photoUrl(id: string): string {
  return `/api/photos/${encodeURIComponent(id)}`;
}
