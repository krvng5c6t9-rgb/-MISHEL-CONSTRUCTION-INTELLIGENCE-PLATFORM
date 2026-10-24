import { useEffect, useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { loadReferenceData, onReferenceDataChange } from '../lib/referenceData';

type Kind = 'projects' | 'clients' | 'vendors' | 'currencies' | 'users' | 'costCodes' | 'contracts' | 'subcontracts' | 'documents' | 'activities' | 'warehouses' | 'inventoryItems';
type Props = { kind: Kind; value: any; onChange: (value: string) => void; placeholder?: string; projectId?: any; allowEmpty?: boolean };
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
const loadRefs = () => loadReferenceData(() => apiGet<any>('/reference-data').then(r => r.data));
function label(kind: Kind, x: any, t: T) {
  switch (kind) {
    case 'projects': return `${x.project_code} — ${x.project_name}`;
    case 'clients': return x.client_name;
    case 'vendors': return x.vendor_name;
    case 'currencies': return x.code;
    case 'users': return `${x.full_name} — ${x.email}`;
    case 'costCodes': return `${x.code} — ${x.description}`;
    case 'contracts': return t('ref.contract', { id: x.id });
    case 'subcontracts': return `${x.package_name} (#${x.id})`;
    case 'documents': return `${x.doc_number || x.file_name} ${x.revision ? t('ref.revision', { rev: x.revision }) : ''}`;
    case 'activities': return `${x.activity_id_ext || x.id} — ${x.activity_name}`;
    case 'warehouses': return `${x.code} — ${x.name}`;
    case 'inventoryItems': return `${x.item_code} — ${x.description}`;
  }
}
// The placeholder is passed in by the calling screen (translated once that screen is); the fallback is translated here.
export function ReferenceSelect({ kind, value, onChange, placeholder, projectId, allowEmpty = true }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<any>({}); const [error, setError] = useState('');
  // F-52: reloads when a change or a new session marks the lists stale (lib/referenceData).
  useEffect(() => {
    let live = true;
    const load = () => loadRefs().then(d => { if (live) { setData(d); setError(''); } }).catch(e => { if (live) setError(e.message); });
    load();
    const off = onReferenceDataChange(load);
    return () => { live = false; off(); };
  }, []);
  const rows = useMemo(() => { const a = data[kind] || []; return projectId ? a.filter((x: any) => x.project_id == null || String(x.project_id) === String(projectId)) : a; }, [data, kind, projectId]);
  return <select value={value ?? ''} onChange={e => onChange(e.target.value)} title={error || placeholder} aria-label={placeholder || t('ref.select', { kind: t(`ref.${kind}` as MessageKey) })}>
    {allowEmpty && <option value="">{error || placeholder || t('ref.select', { kind: t(`ref.${kind}` as MessageKey) })}</option>}
    {rows.map((x: any) => <option key={x.id} value={x.id}>{label(kind, x, t)}</option>)}
  </select>;
}
