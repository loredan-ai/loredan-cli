import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  noExternal: [/.*/],
  minify: false,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
