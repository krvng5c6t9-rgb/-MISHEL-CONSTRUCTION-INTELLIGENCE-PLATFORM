import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, setToken } from '../lib/api';

type LoginResponse = { success: boolean; data: { token: string; user: { full_name: string; role_name: string } } };

export function Login() {
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const parsedOrgId = Number(orgId);
      if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) throw new Error('Organization ID is required');
      const result = await apiPost<LoginResponse>('/auth/login', { email, password, org_id: parsedOrgId });
      setToken(result.data.token);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Construction ERP</p>
        <h1>تسجيل الدخول</h1>
        <p>أدخل بيانات المؤسسة والحساب المصرح به.</p>
        <label>
          Organization ID
          <input value={orgId} onChange={(e: any) => setOrgId(e.target.value)} inputMode="numeric" autoComplete="organization" required />
        </label>
        <label>
          Email
          <input value={email} onChange={(e: any) => setEmail(e.target.value)} type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input value={password} onChange={(e: any) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button disabled={loading}>{loading ? 'Checking...' : 'Login'}</button>
      </form><p><Link to="/setup">First-time company setup</Link></p>
    </main>
  );
}
