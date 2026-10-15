// R1.2 landing dashboard messages. Arabic must have exactly the English keys.
export const en = {
  'dashboard.eyebrow': 'Overview',
  'dashboard.title': 'Dashboard',
  'dashboard.loadError': 'Could not load projects: {error}',
  'dashboard.projects': 'Projects',
  'dashboard.byStatus': 'Projects by status',
  'dashboard.contractValue': 'Current contract value ({currency})',
  'dashboard.contractValueNote': 'Totals are shown per currency and are not converted between currencies.',
  'dashboard.noProjects': 'No projects recorded yet.'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'dashboard.eyebrow': 'نظرة عامة',
  'dashboard.title': 'لوحة التحكم',
  'dashboard.loadError': 'تعذر تحميل المشروعات: {error}',
  'dashboard.projects': 'المشروعات',
  'dashboard.byStatus': 'المشروعات حسب الحالة',
  'dashboard.contractValue': 'قيمة العقود الحالية ({currency})',
  'dashboard.contractValueNote': 'تُعرض الإجماليات لكل عملة على حدة دون تحويل بين العملات.',
  'dashboard.noProjects': 'لا توجد مشروعات مسجلة بعد.'
};
