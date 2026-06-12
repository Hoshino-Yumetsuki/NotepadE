import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Standalone dev-server config for the big-document scroll anchor harness.
// Root is this directory; fs.allow opens the repo root so the harness can
// import the app's editor modules from ../../src.
const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  server: {
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] }
  }
});
