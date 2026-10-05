import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const migrations = fs.readdirSync('database/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join('database/migrations', f), 'utf8'))
  .join('\n');
const sql = stripSqlComments(migrations);
const schema = new Map();

// Some migrations intentionally add the same tenant column to a controlled
// list of existing tables through dynamic SQL. The static parser cannot
// execute that PL/pgSQL, so model that explicit migration contract here.
const dynamicOrgTables = new Set([
  'drawings','submittals','rfis','method_statements','schedule_baselines',
  'schedule_activities','progress_updates','milestones','site_diary',
  'diary_manpower','diary_equipment','site_instructions','quantity_sheets',
  'punch_lists','cost_forecasts','evm_snapshots','subcontracts',
  'subcontract_certificates','subcontract_certificate_lines','schedule_relationships'
]);

for (const table of dynamicOrgTables) {
  const cols = schema.get(table) ?? new Set(['id']);
  cols.add('org_id');
  schema.set(table, cols);
}

for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)\s*\(/gi)) {
  const table = m[1];
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < sql.length && depth > 0) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') depth -= 1;
    i += 1;
  }
  const block = sql.slice(m.index + m[0].length, i - 1);
  const cols = schema.get(table) ?? new Set(['id']);
  for (const part of block.split(',')) {
    const line = part.trim();
    const col = line.match(/^"?([a-zA-Z_][\w]*)"?\s+/)?.[1];
    if (col && !['PRIMARY','FOREIGN','UNIQUE','CHECK','CONSTRAINT','EXCLUDE'].includes(col.toUpperCase())) cols.add(col);
  }
  schema.set(table, cols);
}

for (const m of sql.matchAll(/ALTER\s+TABLE\s+([a-zA-Z_][\w]*)\s+([\s\S]*?);/gi)) {
  const table = m[1];
  const cols = schema.get(table) ?? new Set(['id']);
  for (const c of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][\w]*)/gi)) cols.add(c[1]);
  schema.set(table, cols);
}

const issues = [];
for (const file of walk('backend/src').filter((f) => f.endsWith('.ts'))) {
  const text = fs.readFileSync(file, 'utf8');
  const queries = [...text.matchAll(/`([\s\S]*?(?:select|insert|update|delete)[\s\S]*?)`/gi)].map((m) => m[1]);
  for (const q of queries) {
    const aliases = new Map();
    for (const fm of q.matchAll(/\b(?:from|join)\s+([a-zA-Z_][\w]*)\s+(?:as\s+)?([a-zA-Z_][\w]*)\b/gi)) aliases.set(fm[2], fm[1]);
    for (const fm of q.matchAll(/\bfrom\s+([a-zA-Z_][\w]*)\b/gi)) aliases.set(fm[1], fm[1]);

    for (const im of q.matchAll(/insert\s+into\s+([a-zA-Z_][\w]*)\s*\(([\s\S]*?)\)/gi)) {
      const table = im[1];
      for (const col of im[2].replace(/\s/g, '').split(',').filter(Boolean)) {
        if (schema.has(table) && !schema.get(table).has(col)) issues.push({ file, type: 'insert-column', table, column: col });
      }
    }
    for (const am of q.matchAll(/\b([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)\b/g)) {
      const [alias, col] = [am[1], am[2]];
      const table = aliases.get(alias) ?? (schema.has(alias) ? alias : null);
      if (table && schema.has(table) && !schema.get(table).has(col)) issues.push({ file, type: 'select-column', table, alias, column: col });
    }
  }
}

if (issues.length) {
  console.error(JSON.stringify({ status: 'failed', issues }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'passed', tables_checked: schema.size, backend_sql_files_checked: walk('backend/src').filter((f) => f.endsWith('.ts')).length }, null, 2));
