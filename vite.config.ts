import { defineConfig } from 'vite';
import { genShaderPlugin } from './server/gen-shader';

export default defineConfig(({ mode }) => ({
  plugins: [genShaderPlugin(mode)],
  server: { port: 5178, open: false },
}));
