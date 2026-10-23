// R1.2 First-run set-up messages. Arabic must have exactly the English keys. English text unchanged from the screen
// before translation (scripts/redteam-rev20-check.mjs reads the screen's API call, not its labels).
export const en = {
  'setup.eyebrow': 'First-run onboarding',
  'setup.title': 'Initialize Construction ERP',
  'setup.intro': 'Create the company tenant and first System Administrator without SQL or code changes.',
  'setup.incomplete': 'Complete organization/admin details and provide the 32+ character bootstrap token.',
  'setup.orgName': 'Organization name',
  'setup.legalName': 'Legal name',
  'setup.taxId': 'Tax ID',
  'setup.address': 'Address',
  'setup.currency': 'Base currency (EGP)',
  'setup.adminName': 'Administrator full name',
  'setup.adminEmail': 'Administrator email',
  'setup.adminPassword': 'Administrator password',
  'setup.token': 'Bootstrap token',
  'setup.submit': 'Initialize ERP',
  'setup.backToLogin': 'Back to login'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'setup.eyebrow': 'الإعداد الأول',
  'setup.title': 'تهيئة النظام',
  'setup.intro': 'أنشئ حساب الشركة وأول مدير للنظام دون أوامر قاعدة بيانات أو تعديل في البرنامج.',
  'setup.incomplete': 'أكمل بيانات الشركة والمدير، وأدخل رمز الإعداد الأول (32 حرفًا على الأقل).',
  'setup.orgName': 'اسم الشركة',
  'setup.legalName': 'الاسم القانوني',
  'setup.taxId': 'الرقم الضريبي',
  'setup.address': 'العنوان',
  'setup.currency': 'العملة الأساسية (رمز من 3 أحرف)',
  'setup.adminName': 'الاسم الكامل للمدير',
  'setup.adminEmail': 'البريد الإلكتروني للمدير',
  'setup.adminPassword': 'كلمة مرور المدير',
  'setup.token': 'رمز الإعداد الأول',
  'setup.submit': 'تهيئة النظام',
  'setup.backToLogin': 'العودة لتسجيل الدخول'
};
