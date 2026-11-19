import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'GIS 图块下载',
        short_name: 'GIS 图块下载',
        description: 'GIS 图块下载，支持常见地图与卫星影像。',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'PWA/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: "any"
          },
          {
            src: 'PWA/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  base: '/images-tiles-download/'
})
