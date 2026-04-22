import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  let icalUrl: URL | null = null;
  try {
    if (env.VITE_ICAL_URL) icalUrl = new URL(env.VITE_ICAL_URL);
  } catch {
    icalUrl = null;
  }

  return {
    plugins: [react()],
    server: icalUrl
      ? {
          proxy: {
            '/api/ical': {
              target: icalUrl.origin,
              changeOrigin: true,
              rewrite: () => icalUrl!.pathname + icalUrl!.search,
            },
          },
        }
      : {},
  };
});
