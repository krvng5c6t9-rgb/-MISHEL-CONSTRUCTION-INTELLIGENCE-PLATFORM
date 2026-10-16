// R1.2 (CC-071): screen labels moved into the bilingual dictionaries (frontend/src/lib/messages/*.ts). A static check
// that needs a screen to show a label passes when the label is written in the screen, or when the screen uses a
// dictionary key — t('key') / t('key', …) — whose English text is exactly that label.
import fs from 'node:fs';
const dir = 'frontend/src/lib/messages';
const english = fs.readdirSync(dir).filter(f => f.endsWith('.ts')).flatMap(f => {
  const s = fs.readFileSync(`${dir}/${f}`, 'utf8');
  return [...s.slice(0, s.indexOf('} as const;')).matchAll(/^\s*'([a-zA-Z]+\.[a-zA-Z]+)': '((?:[^'\\]|\\.)*)',?$/gm)].map(m => [m[1], m[2].replace(/\\'/g, "'")]);
});
export function uiHas(src, label) {
  if (src.includes(label)) return true;
  return english.filter(([, text]) => text === label).some(([key]) => src.includes(`t('${key}')`) || src.includes(`t('${key}',`));
}
