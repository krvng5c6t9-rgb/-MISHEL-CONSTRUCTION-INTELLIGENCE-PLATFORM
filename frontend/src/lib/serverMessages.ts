import { formatValue } from './i18n';

// R1.2 batch 8 (CC-079): messages from the server (API refusals, database business rules) shown in the user's language.
// The server keeps one English text per rule (logs, tests and audit read it); the client translates when the message
// arrives: the general messages exactly, the common families by pattern (their fixed words are translated, names and
// numbers kept). A message not covered stays English - the screens isolate it (<bdi>) so it reads correctly inside an
// Arabic sentence. English is never changed.
type Lang = 'ar' | 'en';
const STORAGE_KEY = 'mishel.lang';

function currentLang(): Lang {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ar'; } catch { return 'ar'; }
}

const EXACT: Record<string, string> = {
  'Authentication required': 'يلزم تسجيل الدخول',
  'Missing Bearer token': 'يلزم تسجيل الدخول',
  'Invalid token subject': 'جلسة غير صالحة؛ سجّل الدخول من جديد',
  'Invalid token organization': 'جلسة غير صالحة؛ سجّل الدخول من جديد',
  'Invalid or expired token': 'انتهت الجلسة؛ سجّل الدخول من جديد',
  'Session has been revoked': 'أُنهيت الجلسة؛ سجّل الدخول من جديد',
  'User is inactive or not found': 'المستخدم موقوف أو غير موجود',
  'System Admin role required': 'يتطلب هذا دور مدير النظام',
  'Invalid email or password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'Organization not found or inactive': 'الشركة غير موجودة أو موقوفة',
  'Too many failed sign-in attempts. Try again later.': 'محاولات دخول فاشلة كثيرة. حاول مرة أخرى لاحقًا.',
  'Sign-in challenge is invalid or expired; sign in again': 'انتهت صلاحية خطوة الدخول؛ سجّل الدخول من جديد',
  'Invalid authentication code': 'رمز التحقق غير صحيح',
  'Current password is incorrect': 'كلمة المرور الحالية غير صحيحة',
  'Start the set-up first': 'ابدأ الإعداد أولًا',
  'Set-up already completed or code already used': 'اكتمل الإعداد من قبل أو استُخدم الرمز بالفعل',
  'Multi-factor sign-in is already set up for this user': 'التحقق بخطوتين مُعَدّ بالفعل لهذا المستخدم',
  'Multi-factor sign-in is not set up for this user': 'التحقق بخطوتين غير مُعَدّ لهذا المستخدم',
  'Bootstrap authorization failed': 'رمز الإعداد الأول غير صحيح',
  'Bootstrap is disabled because this organization already has users': 'الإعداد الأول متوقف لأن لدى الشركة مستخدمين بالفعل',
  'Bootstrap is limited to first run; additional tenants require the tenant provisioning process': 'الإعداد الأول للتشغيل الأول فقط؛ الشركات الإضافية تُنشأ بإجراء إنشاء الشركات',
  'No fields to update': 'لا توجد بيانات للتعديل',
  'Project belongs to another organization': 'المشروع تابع لشركة أخرى',
  'Retention is already released': 'المحتجز مُفرَج عنه بالفعل',
  'Punch item is already closed': 'الملاحظة مغلقة بالفعل',
  'Business rule violation': 'مخالفة لقاعدة عمل',
  'A required value is missing': 'قيمة مطلوبة ناقصة',
  'Referenced record does not exist or is still referenced': 'السجل المرتبط غير موجود أو ما زال مرتبطًا بسجلات أخرى',
  'Not permitted for the current organization': 'غير مسموح لهذه الشركة',
  'Invalid input value': 'قيمة مُدخلة غير صالحة',
  'Concurrent update conflict; retry the request': 'تعارض مع تعديل متزامن؛ أعد المحاولة',
  'Value conflicts with an existing record': 'القيمة تتعارض مع سجل موجود',
  'Internal server error': 'خطأ داخلي في الخادم',
  'Set the exchange gain and loss accounts first (exchange settings)': 'حدِّد حسابَي أرباح وخسائر فروق العملة أولًا (إعدادات العملة)',
  'The exchange gain account must be an active revenue account of the organization': 'حساب أرباح فروق العملة يجب أن يكون حساب إيرادات فعّالًا للشركة',
  'The exchange loss account must be an active expense account of the organization': 'حساب خسائر فروق العملة يجب أن يكون حساب مصروفات فعّالًا للشركة',
  'Only asset and liability accounts are monetary items that can be revalued': 'حسابات الأصول والالتزامات فقط بنود نقدية يُعاد تقييمها'
};

// Record names in "… not found" messages.
const NOUN: Record<string, string> = {
  Contract: 'العقد', Claim: 'المطالبة', Variation: 'أمر التغيير', User: 'المستخدم', 'Stock count': 'الجرد', IPC: 'المستخلص',
  'Vendor invoice': 'فاتورة المورد', Tender: 'العطاء', Subcontract: 'عقد الباطن', 'Site diary': 'يومية الموقع', Retention: 'المحتجز',
  'Purchase order': 'أمر الشراء', Project: 'المشروع', Lead: 'الفرصة', Event: 'الحدث', 'DOA row': 'صف مصفوفة الصلاحيات', Client: 'العميل',
  Warehouse: 'المخزن', Vendor: 'المورد', Transfer: 'التحويل', 'Tax code': 'كود الضريبة', Submittal: 'طلب الاعتماد الفني', Role: 'الدور',
  Risk: 'الخطر', 'Revenue run': 'دورة الإيراد', RFI: 'طلب الاستيضاح', 'Programme submission': 'تقديم البرنامج الزمني', Payment: 'الدفعة',
  Drawing: 'الرسم', Document: 'الوثيقة', Inspection: 'الفحص', NCR: 'تقرير عدم المطابقة', Incident: 'الحادث', Permit: 'تصريح العمل',
  Employee: 'الموظف', Equipment: 'المعدة', Asset: 'المعدة', Account: 'الحساب', 'Report pack': 'حزمة التقرير', Snapshot: 'اللقطة',
  Budget: 'الموازنة', Approval: 'الاعتماد', 'Manual journal entry': 'القيد اليدوي', 'Cost transaction': 'حركة التكلفة',
  'Payroll run': 'دورة المرتبات', Activity: 'النشاط', Baseline: 'الخط الأساسي', Milestone: 'المَعلَم', Notice: 'الإخطار'
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Missing permission: ([a-z_]+)\.([a-z_]+)$/, m => `لا تملك صلاحية «${formatValue('ar', m[2])}» على «${formatValue('ar', m[1])}»`],
  [/^Duplicate value violates unique constraint(?: (\S+))?$/, m => `قيمة مكررة: يوجد سجل بالبيانات نفسها${m[1] ? ` (${m[1]})` : ''}`],
  [/^Value violates check constraint(?: (\S+))?$/, m => `قيمة تخالف قيود البيانات${m[1] ? ` (${m[1]})` : ''}`],
  [/^(.+?) not found(?: in current organization| or inactive)?$/, m => `غير موجود: ${NOUN[m[1]] ?? m[1]}`],
  [/^Invalid(?: [a-z ]+)? id$/i, () => 'رقم تعريف غير صالح'],
  [/^Segregation of duties: (.+)$/, m => `فصل المهام: ${m[1]}`],
  [/^Route not found: .+$/, () => 'المسار المطلوب غير موجود'],
  [/^API request failed: (\d+)/, m => `تعذّر تنفيذ الطلب (رمز ${m[1]})`],
  [/^No exchange rate for (?:the project currency )?([A-Z]{3}) on or before (\d{4}-\d{2}-\d{2}) - record it in the exchange-rate register first$/, m => `لا يوجد سعر صرف لـ ${m[1]} بتاريخ ${m[2]} أو قبله؛ سجّله في سجل أسعار الصرف أولًا`],
  [/^No exchange rate for ([A-Z]{3}) on or before (\d{4}-\d{2}-\d{2}) - record the closing rate first$/, m => `لا يوجد سعر صرف لـ ${m[1]} بتاريخ ${m[2]} أو قبله؛ سجّل سعر الإقفال أولًا`],
  [/^The latest exchange rate for ([A-Z]{3}) is dated (\d{4}-\d{2}-\d{2}), more than (\d+) days before (\d{4}-\d{2}-\d{2}) - record a current rate first$/, m => `آخر سعر صرف لـ ${m[1]} بتاريخ ${m[2]}، أي أقدم من ${m[3]} يوم قبل ${m[4]}؛ سجّل سعرًا حديثًا أولًا`],
  [/^An exchange revaluation already exists for (\d{4}-\d{2}-\d{2}); revaluations follow one another in date order$/, m => `توجد إعادة تقييم للعملة بتاريخ ${m[1]}؛ تتوالى إعادات التقييم بترتيب التاريخ`]
];

/** The server message in the user's language; `fields` are the input names a validation error names. */
export function translateServerMessage(message: string, fields: string[] = [], lang: Lang = currentLang()): string {
  if (lang === 'en') return message;
  if (message === 'Validation failed') return fields.length ? `بيانات غير صالحة أو ناقصة في: ${fields.join('، ')}` : 'بيانات غير صالحة أو ناقصة';
  if (EXACT[message]) return EXACT[message];
  for (const [re, f] of PATTERNS) { const m = message.match(re); if (m) return f(m); }
  return message;
}
