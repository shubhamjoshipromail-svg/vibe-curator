import { defineConfig, type Plugin } from 'vite';
import { genShaderPlugin } from './server/gen-shader';
import { mediaPlugin } from './server/media';
import { libraryPlugin } from './server/library';
import { livingDirectorPlugin } from './server/living-director';
import { authPlugin } from './server/auth';

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
  const apiPlugins = [authPlugin(), genShaderPlugin(mode), mediaPlugin(mode), livingDirectorPlugin(mode), libraryPlugin()];
  return {
  plugins: [...apiPlugins, previewApiBridge(apiPlugins)],
  server: { port: 5178, open: false },
  preview: { host: '0.0.0.0', allowedHosts: true },
};
});
