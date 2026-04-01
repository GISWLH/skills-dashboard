import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // Keep yaml external so Electron loads the package directly instead
              // of bundling its CJS build into an ESM main-process bundle.
              external: ['yaml'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
})
