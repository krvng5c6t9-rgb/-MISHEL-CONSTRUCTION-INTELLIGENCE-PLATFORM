import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num, Table } from '../components/RecordTable';

// R1.2: labels from messages/runtime.ts; the schema status through tv(). CC-075: the schema health and posting
// readiness were shown as raw JSON dumps; they are now labelled.
type ApiResponse<T> = { success: boolean; data: T };

export function RuntimeValidation() {
  const { t, tv } = useI18n();
  const [schema, setSchema] = useState<any | null>(null);
  const [posting, setPosting] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      apiGet<ApiResponse<any>>('/runtime-validation/schema-health'),
      apiGet<ApiResponse<any[]>>('/runtime-validation/posting-readiness')
    ]).then(([s, p]) => { setSchema(s.data); setPosting(p.data); }).catch((err) => setError(err.message));
  }, []);
  const missing = [...(schema?.missing_tables ?? []), ...(schema?.missing_views ?? [])];
  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('rv.title')}</h1></div></header>
      {error && <div className="notice" role="alert">{t('rv.apiError')} <bdi>{error}</bdi></div>}
      <div className="kpi-grid" data-section="kpis">
        <article className="kpi-card"><small>{t('rv.schemaStatus')}</small><strong>{schema?.status ? tv(schema.status) : '—'}</strong></article>
        <article className="kpi-card"><small>{t('rv.missingTables')}</small><strong><Num v={schema?.missing_tables?.length} /></strong></article>
        <article className="kpi-card"><small>{t('rv.missingViews')}</small><strong><Num v={schema?.missing_views?.length} /></strong></article>
        <article className="kpi-card"><small>{t('rv.projectsChecked')}</small><strong><Num v={posting.length} /></strong></article>
      </div>
      <div className="panel" data-section="schema"><h2>{t('rv.schemaHealth')}</h2>
        {schema && <p>{t('rv.checked', { tables: schema.checked_tables, views: schema.checked_views })}</p>}
        {schema && <p>{missing.length ? <>{t('rv.missingList', { names: '' })}<bdi dir="ltr">{missing.join(', ')}</bdi></> : t('rv.nothingMissing')}</p>}
      </div>
      <div className="panel" data-section="posting"><h2>{t('rv.postingReadiness')}</h2>
        <Table rows={posting.map(r => ({ ...r, id: r.project_id }))} cols={[['project_name', t('rv.colProject')], ['active_gl_rules', t('rv.colGlRules')], ['active_doa_rows', t('rv.colDoa')], ['workflow_steps', t('rv.colWorkflowSteps')], ['active_accounts', t('rv.colAccounts')]]} />
      </div>
    </section>
  );
}
