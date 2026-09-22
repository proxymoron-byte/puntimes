import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH are set by the GitHub Pages workflow.
// With a custom domain, set BASE_PATH to "/" (repo variable) and SITE_URL to https://yourdomain.
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  trailingSlash: 'always',
});
