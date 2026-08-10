import { defineConfig } from 'vite';
import { genShaderPlugin } from './server/gen-shader';
import { mediaPlugin } from './server/media';

export default defineConfig(({ mode }) => ({
  plugins: [genShaderPlugin(mode), mediaPlugin(mode)],
  server: { port: 5178, open: false },
}));
