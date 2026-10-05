
import fs from 'node:fs';
import path from 'node:path';

const roots = ['backend/src', 'frontend/src'];
let missing = [];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}
for (const root of roots) {
  for (const file of walk(root).filter(f => /\.(ts|tsx)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /from ['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1];
      const base = path.normalize(path.join(path.dirname(file), raw));
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
      if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
      if (!candidates.some(c => fs.existsSync(c))) missing.push({ file, import: raw });
    }
  }
}
if (missing.length) {
  console.error(JSON.stringify({ status: 'failed', missing }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'passed', checked_roots: roots }, null, 2));
