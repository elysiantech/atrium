import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wmondesir.atrium',
  appName: 'Atrium',
  webDir: 'dist',
  android: {
    backgroundColor: '#000000',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
