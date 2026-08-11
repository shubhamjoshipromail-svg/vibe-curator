import { defineConfig } from 'vite';
import { genShaderPlugin } from './server/gen-shader';
import { mediaPlugin } from './server/media';
import { libraryPlugin } from './server/library';

export default defineConfig(({ mode }) => ({
  plugins: [genShaderPlugin(mode), mediaPlugin(mode), libraryPlugin()],
  server: { port: 5178, open: false },
}));
