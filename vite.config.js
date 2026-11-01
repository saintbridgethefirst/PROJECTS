import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The live demo gets its own HTML page (dist/demo.html, served at /demo) with its own title,
// description and canonical in the HTML itself, so search engines see it as a separate page
// rather than a copy of the home page. Everything else is the same app.
const DEMO = {
  title: 'Penteint Projects live demo: try it with a sample team',
  description: 'Try Penteint Projects in your browser with no sign-up: an engineering company, a satellite mission, a drone team or a race car team, with a 2-minute guided tour.',
  url: 'https://app.penteint.com/demo',
};
const esc = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export function demoHtml(html) {
  const swap = (re, to) => { if (!re.test(html)) throw new Error('demo.html: missing ' + re); html = html.replace(re, to); };
  swap(/<title>[^<]*<\/title>/, '<title>' + esc(DEMO.title) + '</title>');
  swap(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(DEMO.description) + '">');
  swap(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + DEMO.url + '">');
  swap(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + DEMO.url + '">');
  swap(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(DEMO.title) + '">');
  swap(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(DEMO.description) + '">');
  swap(/<meta name="twitter:title" content="[^"]*">/, '<meta name="twitter:title" content="' + esc(DEMO.title) + '">');
  swap(/<meta name="twitter:description" content="[^"]*">/, '<meta name="twitter:description" content="' + esc(DEMO.description) + '">');
  return html;
}
function seoPages() {
  let outDir = 'dist';
  return {
    name: 'trawpie-seo-pages', apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() { writeFileSync(resolve(outDir, 'demo.html'), demoHtml(readFileSync(resolve(outDir, 'index.html'), 'utf8'))); },
  };
}

// The live site's security headers (firebase.json), also on the local preview, so every browser test runs
// under the same Content-Security-Policy as app.penteint.com and fails if something needs inline script.
const HEADERS = Object.fromEntries(JSON.parse(readFileSync(new URL('./firebase.json', import.meta.url), 'utf8')).hosting.headers
  .find(h => h.source === '**').headers.map(h => [h.key, h.value]));

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173, headers: HEADERS },
  plugins: [seoPages()],
});
