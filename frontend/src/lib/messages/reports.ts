// R1.2 Reports Center messages. Arabic must have exactly the English keys. English text unchanged from the screen before
// translation ("Reports Center", "Weekly Executive", "Cost Summary", "API Error:") except where the CC-075 defect fixes
// required it: the raw JSON dumps are replaced by labelled tables and the "Phase 6" / "Views" badges are removed.
export const en = {
  'rp.title': 'Reports Center',
  'rp.apiError': 'API Error:',
  'rp.weekly': 'Weekly Executive',
  'rp.colProject': 'Project',
  'rp.colStatus': 'Status',
  'rp.colSpi': 'SPI',
  'rp.colCpi': 'CPI',
  'rp.colPendingApprovals': 'Pending approvals',
  'rp.colOpenNcrs': 'Open NCRs',
  'rp.colOpenSnags': 'Open punch items',
  'rp.colSeriousIncidents': 'Major / fatal incidents',
  'rp.noEvm': 'no EVM snapshot',
  'rp.unscoped': 'Pending approvals not linked to a project: {n}',
  'rp.costSummary': 'Cost Summary',
  'rp.costNote': 'Per project and cost code, in the project currency; each foreign-currency cost at the exchange rate of its own date.',
  'rp.colProjectId': 'Project #',
  'rp.colCode': 'Cost code',
  'rp.colDescription': 'Description',
  'rp.colBudget': 'Budget',
  'rp.colCommitted': 'Committed',
  'rp.colActual': 'Actual',
  'rp.colEac': 'Estimate at completion',
  'rp.colVac': 'Variance at completion'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'rp.title': 'مركز التقارير',
  'rp.apiError': 'خطأ من الخادم:',
  'rp.weekly': 'التقرير الأسبوعي للإدارة',
  'rp.colProject': 'المشروع',
  'rp.colStatus': 'الحالة',
  'rp.colSpi': 'مؤشر أداء الجدول',
  'rp.colCpi': 'مؤشر أداء التكلفة',
  'rp.colPendingApprovals': 'اعتمادات معلّقة',
  'rp.colOpenNcrs': 'تقارير عدم مطابقة مفتوحة',
  'rp.colOpenSnags': 'ملاحظات نهائية مفتوحة',
  'rp.colSeriousIncidents': 'حوادث جسيمة / وفاة',
  'rp.noEvm': 'لا توجد لقطة قيمة مكتسبة',
  'rp.unscoped': 'اعتمادات معلّقة غير مرتبطة بمشروع: {n}',
  'rp.costSummary': 'ملخص التكاليف',
  'rp.costNote': 'حسب المشروع وبند التكلفة بعملة المشروع؛ كل تكلفة بعملة أجنبية محوَّلة بسعر الصرف في تاريخها.',
  'rp.colProjectId': 'رقم المشروع',
  'rp.colCode': 'بند التكلفة',
  'rp.colDescription': 'الوصف',
  'rp.colBudget': 'الموازنة',
  'rp.colCommitted': 'الملتزم به',
  'rp.colActual': 'الفعلي',
  'rp.colEac': 'التكلفة المتوقعة عند الإنجاز',
  'rp.colVac': 'الانحراف عند الإنجاز'
};
