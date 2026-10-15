import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// R1.1 (MP-06 §1): Arabic-first, fully bilingual interface. Every user-visible string of the shell, navigation and
// sign-in screens comes from these dictionaries; the language also sets the document language and direction.
// The two dictionaries must have exactly the same keys (checked by tests/ui/i18n.ui.mjs).
export type Lang = 'ar' | 'en';
const STORAGE_KEY = 'mishel.lang';

const en = {
  'brand.name': 'MISHEL',
  'brand.tagline': 'Construction Enterprise OS',
  'shell.logout': 'Logout',
  'shell.switchLanguage': 'العربية',
  'shell.languageLabel': 'Language',
  'nav.dashboard': 'Dashboard',
  'nav.projects': 'Projects',
  'nav.projectControls': 'Project Controls',
  'nav.payments': 'Payments & Certification',
  'nav.revenue': 'Revenue & Contract Position',
  'nav.cutover': 'Go-live cut-over',
  'nav.users': 'Users / Roles / DOA',
  'nav.crm': 'CRM',
  'nav.tendering': 'Tendering',
  'nav.boq': 'BOQ',
  'nav.contracts': 'Contracts',
  'nav.claims': 'Claims / EOT',
  'nav.subcontracts': 'Subcontracts',
  'nav.costControl': 'Cost Control',
  'nav.procurement': 'Procurement',
  'nav.inventory': 'Inventory',
  'nav.approvals': 'Approvals',
  'nav.finance': 'Finance',
  'nav.technicalOffice': 'Technical Office',
  'nav.planning': 'Planning',
  'nav.site': 'Site Execution',
  'nav.hr': 'HR / Payroll',
  'nav.assets': 'Assets',
  'nav.qaqc': 'QA/QC',
  'nav.hse': 'HSE',
  'nav.edms': 'EDMS',
  'nav.executiveDashboard': 'Executive Dashboard',
  'nav.reports': 'Reports',
  'nav.portals': 'Portals',
  'nav.runtimeValidation': 'Runtime Validation',
  'nav.aiPlatform': 'AI Platform',
  'nav.automation': 'Automation / Integrations',
  'nav.knowledge': 'Knowledge / RAG',
  'nav.commercialPlatform': 'Commercial SaaS',
  'login.title': 'Sign in',
  'login.intro': 'Enter your organization and your authorised account.',
  'login.orgId': 'Organization ID',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Login',
  'login.checking': 'Checking...',
  'login.firstSetup': 'First-time company setup',
  'login.failed': 'Sign-in failed',
  'login.orgRequired': 'Organization ID is required',
  'mfa.titleEnroll': 'Set up two-step verification',
  'mfa.titleVerify': 'Two-step verification',
  'mfa.enrollIntro': 'Your account requires two-step verification. Add the account to an authenticator app (Google Authenticator, Microsoft Authenticator or similar) with the key below, then enter the 6-digit code.',
  'mfa.openApp': 'Open in the authenticator app on this device',
  'mfa.enterRecovery': 'Enter one of your recovery codes.',
  'mfa.enterCode': 'Enter the 6-digit code from your authenticator app.',
  'mfa.recoveryCode': 'Recovery code',
  'mfa.authCode': 'Authentication code',
  'mfa.verify': 'Verify',
  'mfa.useApp': 'Use the app code',
  'mfa.useRecovery': 'Lost the device? Use a recovery code',
  'mfa.back': 'Back',
  'mfa.codesTitle': 'Recovery codes',
  'mfa.codesIntro': 'Keep these codes somewhere safe. Each code works once if you lose your authenticator device, and they will not be shown again.',
  'mfa.codesSaved': 'Saved — continue'
} as const;

export type MessageKey = keyof typeof en;

const ar: Record<MessageKey, string> = {
  'brand.name': 'ميشيل',
  'brand.tagline': 'منظومة إدارة شركات المقاولات',
  'shell.logout': 'تسجيل الخروج',
  'shell.switchLanguage': 'English',
  'shell.languageLabel': 'اللغة',
  'nav.dashboard': 'لوحة التحكم',
  'nav.projects': 'المشروعات',
  'nav.projectControls': 'ضبط المشروعات',
  'nav.payments': 'المستخلصات والمدفوعات',
  'nav.revenue': 'الإيرادات وموقف العقود',
  'nav.cutover': 'الانتقال للتشغيل',
  'nav.users': 'المستخدمون والأدوار وصلاحيات الاعتماد',
  'nav.crm': 'العملاء وتطوير الأعمال',
  'nav.tendering': 'العطاءات',
  'nav.boq': 'المقايسات',
  'nav.contracts': 'العقود',
  'nav.claims': 'المطالبات ومد المدة',
  'nav.subcontracts': 'مقاولو الباطن',
  'nav.costControl': 'ضبط التكاليف',
  'nav.procurement': 'المشتريات',
  'nav.inventory': 'المخازن',
  'nav.approvals': 'الاعتمادات',
  'nav.finance': 'المالية',
  'nav.technicalOffice': 'المكتب الفني',
  'nav.planning': 'التخطيط',
  'nav.site': 'التنفيذ بالموقع',
  'nav.hr': 'الموارد البشرية والمرتبات',
  'nav.assets': 'الأصول والمعدات',
  'nav.qaqc': 'الجودة',
  'nav.hse': 'السلامة والصحة المهنية والبيئة',
  'nav.edms': 'إدارة المستندات',
  'nav.executiveDashboard': 'لوحة الإدارة العليا',
  'nav.reports': 'التقارير',
  'nav.portals': 'البوابات',
  'nav.runtimeValidation': 'التحقق التشغيلي',
  'nav.aiPlatform': 'منصة الذكاء الاصطناعي',
  'nav.automation': 'الأتمتة والتكاملات',
  'nav.knowledge': 'قاعدة المعرفة',
  'nav.commercialPlatform': 'الاشتراكات التجارية',
  'login.title': 'تسجيل الدخول',
  'login.intro': 'أدخل بيانات المؤسسة والحساب المصرح به.',
  'login.orgId': 'رقم المؤسسة',
  'login.email': 'البريد الإلكتروني',
  'login.password': 'كلمة المرور',
  'login.submit': 'دخول',
  'login.checking': 'جارٍ التحقق...',
  'login.firstSetup': 'إعداد الشركة لأول مرة',
  'login.failed': 'تعذر تسجيل الدخول',
  'login.orgRequired': 'رقم المؤسسة مطلوب',
  'mfa.titleEnroll': 'إعداد التحقق بخطوتين',
  'mfa.titleVerify': 'التحقق بخطوتين',
  'mfa.enrollIntro': 'حسابك يتطلب التحقق بخطوتين. أضف الحساب في تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator أو ما يماثلهما) بالمفتاح التالي، ثم أدخل الرمز المكوّن من 6 أرقام.',
  'mfa.openApp': 'فتح في تطبيق المصادقة على هذا الجهاز',
  'mfa.enterRecovery': 'أدخل أحد رموز الاسترداد.',
  'mfa.enterCode': 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
  'mfa.recoveryCode': 'رمز الاسترداد',
  'mfa.authCode': 'رمز المصادقة',
  'mfa.verify': 'تحقق',
  'mfa.useApp': 'استخدام رمز التطبيق',
  'mfa.useRecovery': 'فقدت الجهاز؟ استخدم رمز استرداد',
  'mfa.back': 'رجوع',
  'mfa.codesTitle': 'رموز الاسترداد',
  'mfa.codesIntro': 'احفظ هذه الرموز في مكان آمن. كل رمز يُستخدم مرة واحدة إذا فقدت جهاز المصادقة، ولن تظهر مرة أخرى.',
  'mfa.codesSaved': 'حفظتها — متابعة'
};

export const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, ar };

function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch { /* storage unavailable: fall back to the default */ }
  return 'ar';
}

type I18n = { lang: Lang; dir: 'rtl' | 'ltr'; t: (key: MessageKey) => string; setLang: (lang: Lang) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);
  const setLang = useCallback((next: Lang) => {
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted; still switches */ }
    setLangState(next);
  }, []);
  const t = useCallback((key: MessageKey) => dictionaries[lang][key], [lang]);
  const value = useMemo(() => ({ lang, dir, t, setLang }), [lang, dir, t, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, t, setLang } = useI18n();
  return (
    <button type="button" className={className ?? 'language-switch'} aria-label={t('shell.languageLabel')}
      lang={lang === 'ar' ? 'en' : 'ar'} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
      {t('shell.switchLanguage')}
    </button>
  );
}
