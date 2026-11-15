/// <reference types="vitest/config" />
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// One self-contained file: `widget.js` is what hotels include with a single <script> tag.
export default defineConfig({
  plugins: [preact()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    lib: { entry: 'src/main.ts', name: 'RotaWidget', formats: ['iife'], fileName: () => 'widget.js' },
    target: 'es2020',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    css: true, // `styles/widget.css?inline` must really load: tests assert on the injected stylesheet
  },
});
