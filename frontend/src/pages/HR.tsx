import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export function HR() {
  const [employees, setEmployees] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [payroll, setPayroll] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([api.get('/hr/employees'), api.get('/hr/attendance'), api.get('/hr/payroll-runs')]).then(([e, a, p]) => {
      setEmployees(e.data.slice(0, 8));
      setAttendance(a.data.slice(0, 8));
      setPayroll(p.data.slice(0, 8));
    });
  }, []);

  return (
    <section className="page">
      <h1>HR / Payroll</h1>
      <p className="muted">Employees, attendance, timesheets, leave requests, payroll runs, and posting control.</p>
      <div className="cards-grid">
        <div className="metric-card"><span>Employees</span><strong>{employees.length}</strong></div>
        <div className="metric-card"><span>Attendance Rows</span><strong>{attendance.length}</strong></div>
        <div className="metric-card"><span>Payroll Runs</span><strong>{payroll.length}</strong></div>
      </div>
      <div className="panel">
        <h2>Employees</h2>
        <table><thead><tr><th>Code</th><th>Name</th><th>Job</th><th>Status</th></tr></thead><tbody>
          {employees.map((e) => <tr key={e.id}><td>{e.employee_code}</td><td>{e.full_name}</td><td>{e.job_title || '-'}</td><td>{e.employment_status}</td></tr>)}
        </tbody></table>
      </div>
      <div className="panel">
        <h2>Payroll Runs</h2>
        <table><thead><tr><th>Period</th><th>Status</th><th>Total</th></tr></thead><tbody>
          {payroll.map((p) => <tr key={p.id}><td>{p.period_month}</td><td>{p.status}</td><td>{p.total_amount || '-'}</td></tr>)}
        </tbody></table>
      </div>
    </section>
  );
}
