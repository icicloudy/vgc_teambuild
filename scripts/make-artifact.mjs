/**
 * Turns the single-file build into an Artifact-ready fragment.
 *
 * The Artifact host supplies its own <!doctype>/<html>/<head>/<body> skeleton, so
 * the published file must contain page content only. This lifts the <title>,
 * <style> and <script> out of the built document and re-emits them in an order
 * that keeps the title inside the first 8KB, where the host looks for it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const IN = process.argv[2] || 'dist-artifact/index.html';
const OUT = process.argv[3] || 'artifact/champions-teambuilder.html';

const html = readFileSync(IN, 'utf8');

const pick = (re, label) => {
  const m = re.exec(html);
  if (!m) throw new Error(`could not find ${label} in ${IN}`);
  return m[0];
};

const title = pick(/<title>[\s\S]*?<\/title>/i, '<title>');
const style = pick(/<style[^>]*>[\s\S]*?<\/style>/i, '<style>');
const script = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/i, 'module <script>');
const root = pick(/<div id="root">[\s\S]*?<\/div>\s*<\/body>/i, '#root')
  .replace(/\s*<\/body>$/i, '');

if (/<script[^>]*\ssrc=/i.test(html) || /<link[^>]*\shref="(?!data:)/i.test(script + style)) {
  throw new Error('build still references an external asset — it would be blocked by CSP');
}

const out = [title, style, root, script].join('\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

const mb = (out.length / 1024 / 1024).toFixed(2);
console.log(`wrote ${OUT} — ${mb} MB`);
if (out.length > 16 * 1024 * 1024) {
  console.error('over the 16MB artifact limit');
  process.exit(1);
}
