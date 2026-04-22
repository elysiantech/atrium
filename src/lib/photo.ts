const FALLBACK =
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1600&q=80';

export function getBackgroundImage(): string {
  return import.meta.env.VITE_BACKGROUND_IMAGE_URL || FALLBACK;
}
