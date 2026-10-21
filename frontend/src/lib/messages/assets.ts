// R1.2 Assets / Equipment screen messages. Arabic must have exactly the English keys. English text unchanged from the
// screen before translation; ownership and statuses through tv().
export const en = {
  'as.title': 'Assets / Equipment',
  'as.intro': 'Equipment register, utilization, maintenance log, and approved usage cost posting.',
  'as.equipmentKpi': 'Equipment',
  'as.usageLogs': 'Usage Logs',
  'as.maintenance': 'Maintenance',
  'as.register': 'Equipment Register',
  'as.colCode': 'Code',
  'as.colName': 'Name',
  'as.colOwnership': 'Ownership',
  'as.colStatus': 'Status',
  'as.recentUsage': 'Recent Usage',
  'as.colDate': 'Date',
  'as.colAsset': 'Asset',
  'as.colHours': 'Hours',
  'as.colCost': 'Cost'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'as.title': 'الأصول / المعدات',
  'as.intro': 'سجل المعدات، ومعدلات التشغيل، وسجل الصيانة، وترحيل تكلفة التشغيل المعتمدة.',
  'as.equipmentKpi': 'المعدات',
  'as.usageLogs': 'سجلات التشغيل',
  'as.maintenance': 'الصيانة',
  'as.register': 'سجل المعدات',
  'as.colCode': 'الكود',
  'as.colName': 'الاسم',
  'as.colOwnership': 'الملكية',
  'as.colStatus': 'الحالة',
  'as.recentUsage': 'أحدث سجلات التشغيل',
  'as.colDate': 'التاريخ',
  'as.colAsset': 'المعدة',
  'as.colHours': 'الساعات',
  'as.colCost': 'التكلفة'
};
