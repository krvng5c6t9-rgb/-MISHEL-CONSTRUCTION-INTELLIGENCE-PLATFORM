// R1.2 Site Execution screen messages. Arabic must have exactly the English keys. English text unchanged from the
// screen before translation; statuses through tv().
export const en = {
  'site.title': 'Site Execution',
  'site.intro': 'Daily diaries, manpower, equipment, site instructions, verified quantities, and punch list.',
  'site.dailyReports': 'Daily Reports',
  'site.quantitySheets': 'Quantity Sheets',
  'site.openPunch': 'Open Punch Items',
  'site.recentDiaries': 'Recent Site Diaries',
  'site.colDate': 'Date',
  'site.colWeather': 'Weather',
  'site.colWork': 'Work Performed',
  'site.colDelays': 'Delays',
  'site.punchList': 'Punch List',
  'site.colLocation': 'Location',
  'site.colDescription': 'Description',
  'site.colStatus': 'Status',
  'site.colDue': 'Due'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'site.title': 'تنفيذ الموقع',
  'site.intro': 'اليوميات، والعمالة، والمعدات، وتعليمات الموقع، والكميات المُتحقَّق منها، وقائمة الملاحظات النهائية.',
  'site.dailyReports': 'التقارير اليومية',
  'site.quantitySheets': 'كشوف الكميات',
  'site.openPunch': 'الملاحظات المفتوحة',
  'site.recentDiaries': 'أحدث يوميات الموقع',
  'site.colDate': 'التاريخ',
  'site.colWeather': 'الطقس',
  'site.colWork': 'الأعمال المنفذة',
  'site.colDelays': 'التأخيرات',
  'site.punchList': 'قائمة الملاحظات النهائية',
  'site.colLocation': 'الموقع',
  'site.colDescription': 'الوصف',
  'site.colStatus': 'الحالة',
  'site.colDue': 'الموعد'
};
