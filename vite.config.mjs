import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  build: {
    outDir: 'public/dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/voting.js',
      output: {
        entryFileNames: 'bundle.js',
        format: 'es'
      }
    }
  },
  optimizeDeps: {
    include: ['snarkjs']
  }
});