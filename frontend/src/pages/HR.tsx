import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n, type MessageKey } from '../lib/i18n';
import { Num } from '../components/RecordTable';

// R1.2: labels from messages/hr.ts; payroll statuses through tv(); employment status through the screen's own keys.
// CC-074: the tiles counted only the first 8 rows loaded (the counts now use every row the API returned), and a failed
// load left the page empty with no message (the server message is now shown).
const EMP: Record<string, MessageKey> = { active: 'hr.empActive', on_leave: 'hr.empOnLeave', terminated: 'hr.empTerminated' };
export function HR() {
  const { t, tv } = useI18n();
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/hr/employees'), api.get('/hr/attendance'), api.get('/hr/payroll-runs')]).then(([e, a, p]) => {
      setEmployees(e.data);
      setAttendance(a.data);
      setPayroll(p.data);
    }).catch((x: any) => setError(x.message));
  }, []);

  return (
    <section className="page-stack">
      <header className="page-header"><div><h1>{t('hr.title')}</h1><p>{t('hr.intro')}</p></div></header>
      {error && <div className="notice" role="alert"><bdi>{error}</bdi></div>}
      <div className="cards-grid">
        <div className="metric-card"><span>{t('hr.employeesKpi')}</span><strong><Num v={employees.length} /></strong></div>
        <div className="metric-card"><span>{t('hr.attendanceRows')}</span><strong><Num v={attendance.length} /></strong></div>
        <div className="metric-card"><span>{t('hr.payrollRunsKpi')}</span><strong><Num v={payroll.length} /></strong></div>
      </div>
      <div className="panel" data-section="employees">
        <h2>{t('hr.employees')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('hr.colCode')}</th><th>{t('hr.colName')}</th><th>{t('hr.colJob')}</th><th>{t('hr.colStatus')}</th></tr></thead><tbody>
          {employees.slice(0, 8).map((e) => <tr key={e.id}><td>{e.employee_code}</td><td>{e.full_name}</td><td>{e.job_title || '-'}</td><td>{EMP[e.employment_status] ? t(EMP[e.employment_status]) : e.employment_status}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="panel" data-section="payroll">
        <h2>{t('hr.payrollRuns')}</h2>
        <div className="table-wrap"><table><thead><tr><th>{t('hr.colPeriod')}</th><th>{t('hr.colStatus')}</th><th>{t('hr.colTotal')}</th></tr></thead><tbody>
          {payroll.slice(0, 8).map((p) => <tr key={p.id}><td><Num text={String(p.period_month ?? '-')} /></td><td>{tv(p.status)}</td><td>{p.total_amount ? <Num v={p.total_amount} /> : '-'}</td></tr>)}
        </tbody></table></div>
      </div>
    </section>
  );
}
