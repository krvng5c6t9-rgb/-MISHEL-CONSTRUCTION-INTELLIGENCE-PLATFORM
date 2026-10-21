import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.2: labels from messages/site.ts; statuses through tv(). CC-074: the tiles counted only the first 8 rows loaded
// (the tables show 8; the counts now use every row the API returned), and a failed load left the page empty with no
// message (the server message is now shown).
export function SiteExecution() {
  const { t, tv } = useI18n();
  const [diaries, setDiaries] = useState<any[]>([]);
  const [punch, setPunch] = useState<any[]>([]);
  const [qs, setQs] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/site/diaries'), api.get('/site/punch-list'), api.get('/site/quantity-sheets')]).then(([d, p, q]) => {
      setDiaries(d.data);
      setPunch(p.data);
      setQs(q.data);
    }).catch((e: any) => setError(e.message));
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('site.title')}</h1><p>{t('site.intro')}</p></div></header>
      {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
      <div className="cards-grid">
        <div className="metric-card"><span>{t('site.dailyReports')}</span><strong><Num v={diaries.length} /></strong></div>
        <div className="metric-card"><span>{t('site.quantitySheets')}</span><strong><Num v={qs.length} /></strong></div>
        <div className="metric-card"><span>{t('site.openPunch')}</span><strong><Num v={punch.filter((x) => x.status !== 'closed').length} /></strong></div>
      </div>
      <div className="panel" data-section="diaries">
        <h2>{t('site.recentDiaries')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('site.colDate')}</th><th>{t('site.colWeather')}</th><th>{t('site.colWork')}</th><th>{t('site.colDelays')}</th></tr></thead><tbody>
          {diaries.slice(0, 8).map((d) => <tr key={d.id}><td><Num text={d.diary_date || '-'} /></td><td>{d.weather || '-'}</td><td>{d.work_performed || '-'}</td><td>{d.delays_notes || '-'}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="panel" data-section="punch">
        <h2>{t('site.punchList')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('site.colLocation')}</th><th>{t('site.colDescription')}</th><th>{t('site.colStatus')}</th><th>{t('site.colDue')}</th></tr></thead><tbody>
          {punch.slice(0, 8).map((p) => <tr key={p.id}><td>{p.location || '-'}</td><td>{p.description}</td><td>{tv(p.status)}</td><td><Num text={p.due_date || '-'} /></td></tr>)}
        </tbody></table></div>
      </div>
    </section>
  );
}
