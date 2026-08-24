import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()],
  build: {
    outDir: 'public/dist',
    emptyOutDir: false,  // Don't delete bundle.js when building demo
    rollupOptions: {
      input: 'src/voting_demo.js',
      output: {
        entryFileNames: 'bundle_demo.js',
        format: 'es'
      }
    }
  },
  optimizeDeps: {
    include: ['snarkjs']
  }
});
