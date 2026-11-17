import { defineConfig } from 'vite';

// base './' keeps every asset path relative, so the same build works on
// Vercel, Netlify and GitHub Pages project sites (served from /repo-name/).
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      // the game, plus the /admin visits dashboard
      input: { main: 'index.html', admin: 'admin/index.html' },
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
