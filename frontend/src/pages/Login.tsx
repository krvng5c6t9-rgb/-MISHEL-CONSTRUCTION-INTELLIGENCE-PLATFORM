import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiPost, setToken } from '../lib/api';

type Session = { token: string; user: { full_name: string; role_name: string } };
type LoginData = Partial<Session> & { mfa_required?: boolean; mfa_enrollment_required?: boolean; challenge_token?: string };
type Step = 'password' | 'verify' | 'enroll' | 'codes';

// Stage 32 / DEC-015: privileged users complete sign-in with an authenticator code (TOTP). The password step returns
// only a short-lived challenge; first-time users set up their authenticator here and receive one-time recovery codes.
export function Login() {
  const [orgId, setOrgId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [enrolment, setEnrolment] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingToken, setPendingToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const enter = (token: string) => { setToken(token); window.location.href = '/'; };
  async function guarded(fn: () => Promise<void>) {
    setLoading(true); setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); } finally { setLoading(false); }
  }

  const submitPassword = (event: FormEvent) => { event.preventDefault(); void guarded(async () => {
    const parsedOrgId = Number(orgId);
    if (!Number.isInteger(parsedOrgId) || parsedOrgId <= 0) throw new Error('Organization ID is required');
    const { data } = await apiPost<{ data: LoginData }>('/auth/login', { email, password, org_id: parsedOrgId });
    if (data.token) return enter(data.token);
    setChallenge(data.challenge_token ?? ''); setPassword('');
    if (data.mfa_required) { setStep('verify'); return; }
    const en = await apiPost<{ data: { secret: string; otpauth_uri: string } }>('/auth/mfa/enroll', { challenge_token: data.challenge_token });
    setEnrolment(en.data); setStep('enroll');
  }); };

  const submitCode = (event: FormEvent) => { event.preventDefault(); void guarded(async () => {
    if (step === 'enroll') {
      const { data } = await apiPost<{ data: Session & { recovery_codes: string[] } }>('/auth/mfa/enroll/confirm', { challenge_token: challenge, code: code.trim() });
      setRecoveryCodes(data.recovery_codes); setPendingToken(data.token); setStep('codes');
      return;
    }
    const body = useRecovery ? { challenge_token: challenge, recovery_code: code.trim() } : { challenge_token: challenge, code: code.trim() };
    const { data } = await apiPost<{ data: Session }>('/auth/mfa/verify', body);
    enter(data.token);
  }); };

  const restart = () => { setStep('password'); setChallenge(''); setCode(''); setEnrolment(null); setError(null); setUseRecovery(false); };

  if (step === 'codes') return (
    <main className="login-page">
      <section className="login-card" data-section="mfa-recovery-codes">
        <p className="eyebrow">Construction ERP</p>
        <h1>رموز الاسترداد</h1>
        <p>احفظ هذه الرموز في مكان آمن. كل رمز يُستخدم مرة واحدة إذا فقدت جهاز المصادقة، ولن تظهر مرة أخرى.</p>
        <ol dir="ltr" className="recovery-codes">{recoveryCodes.map(c => <li key={c}><code>{c}</code></li>)}</ol>
        <button onClick={() => enter(pendingToken)}>حفظتها — متابعة</button>
      </section>
    </main>
  );

  if (step === 'verify' || step === 'enroll') return (
    <main className="login-page">
      <form className="login-card" onSubmit={submitCode} data-section={step === 'enroll' ? 'mfa-enroll' : 'mfa-verify'}>
        <p className="eyebrow">Construction ERP</p>
        <h1>{step === 'enroll' ? 'إعداد التحقق بخطوتين' : 'التحقق بخطوتين'}</h1>
        {step === 'enroll' && enrolment && <>
          <p>حسابك يتطلب التحقق بخطوتين. أضف الحساب في تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator أو ما يماثلهما) بالمفتاح التالي، ثم أدخل الرمز المكوّن من 6 أرقام.</p>
          <p dir="ltr"><code className="mfa-secret">{enrolment.secret.match(/.{1,4}/g)?.join(' ')}</code></p>
          <p><a href={enrolment.otpauth_uri}>فتح في تطبيق المصادقة على هذا الجهاز</a></p>
        </>}
        {step === 'verify' && <p>{useRecovery ? 'أدخل أحد رموز الاسترداد.' : 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.'}</p>}
        <label>
          {useRecovery ? 'Recovery code' : 'Authentication code'}
          <input value={code} onChange={(e: any) => setCode(e.target.value)} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" required autoFocus />
        </label>
        {error && <div className="error-box">{error}</div>}
        <button disabled={loading}>{loading ? 'Checking...' : 'Verify'}</button>
        {step === 'verify' && <button type="button" className="link-button" onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>
          {useRecovery ? 'استخدام رمز التطبيق' : 'فقدت الجهاز؟ استخدم رمز استرداد'}</button>}
        <button type="button" className="link-button" onClick={restart}>رجوع</button>
      </form>
    </main>
  );

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submitPassword}>
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
