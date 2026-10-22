// R1.2 Runtime Validation messages. Arabic must have exactly the English keys. English text unchanged from the screen
// before translation ("Runtime Validation", "Schema Status", "Missing Tables", "Missing Views", "Projects Checked",
// "Schema Health", "Posting Readiness", "API Error:") except where the CC-075 defect fixes required it: raw JSON dumps
// replaced by labelled content; "Phase 6" / "Checklist" badges removed.
export const en = {
  'rv.title': 'Runtime Validation',
  'rv.apiError': 'API Error:',
  'rv.schemaStatus': 'Schema Status',
  'rv.missingTables': 'Missing Tables',
  'rv.missingViews': 'Missing Views',
  'rv.projectsChecked': 'Projects Checked',
  'rv.schemaHealth': 'Schema Health',
  'rv.checked': '{tables} tables and {views} views checked.',
  'rv.missingList': 'Missing: {names}',
  'rv.nothingMissing': 'Nothing missing.',
  'rv.postingReadiness': 'Posting Readiness',
  'rv.colProject': 'Project',
  'rv.colGlRules': 'Active GL posting rules',
  'rv.colDoa': 'Active DOA rows',
  'rv.colWorkflowSteps': 'Approval workflow steps',
  'rv.colAccounts': 'Active accounts'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'rv.title': 'التحقق من جاهزية التشغيل',
  'rv.apiError': 'خطأ من الخادم:',
  'rv.schemaStatus': 'حالة قاعدة البيانات',
  'rv.missingTables': 'جداول ناقصة',
  'rv.missingViews': 'عروض ناقصة',
  'rv.projectsChecked': 'المشروعات التي فُحصت',
  'rv.schemaHealth': 'سلامة قاعدة البيانات',
  'rv.checked': 'فُحص {tables} جدولًا و{views} عرضًا.',
  'rv.missingList': 'الناقص: {names}',
  'rv.nothingMissing': 'لا يوجد نقص.',
  'rv.postingReadiness': 'جاهزية الترحيل',
  'rv.colProject': 'المشروع',
  'rv.colGlRules': 'قواعد الترحيل المحاسبي الفعالة',
  'rv.colDoa': 'صفوف مصفوفة الصلاحيات الفعالة',
  'rv.colWorkflowSteps': 'خطوات دورة الاعتماد',
  'rv.colAccounts': 'الحسابات الفعالة'
};
