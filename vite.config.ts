import { defineConfig, type Plugin } from 'vite';
import { genShaderPlugin } from './server/gen-shader';
import { mediaPlugin } from './server/media';
import { libraryPlugin } from './server/library';
import { livingDirectorPlugin } from './server/living-director';
import { authPlugin } from './server/auth';
import { billingPlugin } from './server/billing';
import { stripePlugin } from './server/stripe';
import { securityPlugin } from './server/security';
import { privacyPlugin } from './server/privacy';
import { nativeActivationPlugin } from './server/native';
import { legacyCuratedAudioPlugin } from './server/legacy-audio';

function previewApiBridge(apiPlugins: Plugin[]): Plugin {
  return {
    name: 'vibe-preview-api-bridge',
    configurePreviewServer(server) {
      for (const plugin of apiPlugins) {
        const hook = plugin.configureServer;
        if (typeof hook === 'function') void hook(server as never);
      }
      server.middlewares.use('/api/health', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, service: 'vibe-curator' }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const publicHost = (() => {
    const value = process.env.APP_URL || process.env.BETTER_AUTH_URL
      || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
    return value ? new URL(value).hostname : undefined;
  })();
  const allowedHosts = [...new Set(['localhost', '127.0.0.1', ...(publicHost ? [publicHost] : [])])];
  const apiPlugins = [
    securityPlugin(),
    legacyCuratedAudioPlugin(),
    authPlugin(),
    privacyPlugin(),
    nativeActivationPlugin(),
    billingPlugin(),
    stripePlugin(),
    genShaderPlugin(mode),
    mediaPlugin(mode),
    livingDirectorPlugin(mode),
    libraryPlugin(),
  ];
  return {
  plugins: [...apiPlugins, previewApiBridge(apiPlugins)],
  server: { port: 5178, open: false, allowedHosts },
  preview: { host: '0.0.0.0', allowedHosts },
  build: {
    rollupOptions: {
      input: {
        app: 'index.html',
        wallpaper: 'wallpaper.html',
        nativeControls: 'native-controls.html',
      },
    },
  },
};
});
