import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'net.washoi.game',
  appName: 'Washiki Washoi!',
  webDir: 'dist',
  server: {
    // Uncomment for live reload during development:
    // url: 'http://YOUR_LOCAL_IP:3000',
    // cleartext: true
  },
  android: {
    backgroundColor: '#1a1a2e',
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
      launchAutoHide: false, // We'll hide it manually after loading
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
    },
  },
};

export default config;
