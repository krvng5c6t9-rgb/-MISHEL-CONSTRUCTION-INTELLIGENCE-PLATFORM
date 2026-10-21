import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.2: labels from messages/assets.ts; ownership and statuses through tv(). CC-074: the tiles counted only the first
// 8 rows loaded (the counts now use every row the API returned); a failed load left the page empty with no message
// (the server message is now shown); usage cost is shown with its currency (it was a bare amount).
export function Assets() {
  const { t, tv } = useI18n();
  const [equipment, setEquipment] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [maintenance, setMaintenance] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/assets/equipment'), api.get('/assets/equipment-usage'), api.get('/assets/maintenance'), api.get('/reference-data').catch(() => ({ data: {} }))]).then(([e, u, m, r]) => {
      setEquipment(e.data);
      setUsage(u.data);
      setMaintenance(m.data);
      setCurrencies(Object.fromEntries((r.data?.currencies ?? []).map((c: any) => [String(c.id), c.code])));
    }).catch((x: any) => setError(x.message));
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('as.title')}</h1><p>{t('as.intro')}</p></div></header>
      {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
      <div className="cards-grid">
        <div className="metric-card"><span>{t('as.equipmentKpi')}</span><strong><Num v={equipment.length} /></strong></div>
        <div className="metric-card"><span>{t('as.usageLogs')}</span><strong><Num v={usage.length} /></strong></div>
        <div className="metric-card"><span>{t('as.maintenance')}</span><strong><Num v={maintenance.length} /></strong></div>
      </div>
      <div className="panel" data-section="equipment">
        <h2>{t('as.register')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('as.colCode')}</th><th>{t('as.colName')}</th><th>{t('as.colOwnership')}</th><th>{t('as.colStatus')}</th></tr></thead><tbody>
          {equipment.slice(0, 8).map((x) => <tr key={x.id}><td>{x.asset_code}</td><td>{x.asset_name}</td><td>{tv(x.ownership_type)}</td><td>{tv(x.status)}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="panel" data-section="usage">
        <h2>{t('as.recentUsage')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('as.colDate')}</th><th>{t('as.colAsset')}</th><th>{t('as.colHours')}</th><th>{t('as.colCost')}</th><th>{t('as.colStatus')}</th></tr></thead><tbody>
          {usage.slice(0, 8).map((u) => <tr key={u.id}><td><Num text={u.usage_date || '-'} /></td><td>{u.asset_name}</td><td><Num v={u.hours_used} /></td><td><Num v={u.cost_amount} /> {currencies[String(u.currency_id)] ?? ''}</td><td>{tv(u.status)}</td></tr>)}
        </tbody></table></div>
      </div>
    </section>
  );
}
