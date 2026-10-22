// R1.2 Enterprise Knowledge & RAG messages. Arabic must have exactly the English keys. English text unchanged from the
// screen before translation (title, intro, tile labels, tab names, "No records yet.", "Failed to load knowledge") except
// the CC-075 defect fix: each tab has defined, labelled columns (the screen showed the first 9 raw API fields).
export const en = {
  'kn.title': 'Enterprise Knowledge & RAG',
  'kn.intro': 'Controlled sources, revisions, authority hierarchy, chunks, grounded queries and citations.',
  'kn.loadFailed': 'Failed to load knowledge',
  'kn.sources': 'Sources',
  'kn.current': 'Current',
  'kn.chunks': 'Chunks',
  'kn.queries': 'Queries',
  'kn.grounded': 'Grounded',
  'kn.tabSources': 'sources',
  'kn.tabQueries': 'queries',
  'kn.noRecords': 'No records yet.',
  'kn.colKey': 'Key',
  'kn.colTitle': 'Title',
  'kn.colType': 'Type',
  'kn.colAuthority': 'Authority level',
  'kn.colRevision': 'Revision',
  'kn.colStatus': 'Status',
  'kn.colEffective': 'Effective date',
  'kn.colAsked': 'Asked at',
  'kn.colQuestion': 'Question',
  'kn.colModel': 'Model',
  'kn.colGrounded': 'Grounded'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'kn.title': 'معرفة المؤسسة والاسترجاع المعزز',
  'kn.intro': 'مصادر مضبوطة، وإصداراتها، وتسلسل حجيتها، وأجزاؤها، واستعلامات مستندة إلى المصادر، والاستشهادات.',
  'kn.loadFailed': 'تعذّر تحميل المعرفة',
  'kn.sources': 'المصادر',
  'kn.current': 'السارية',
  'kn.chunks': 'الأجزاء',
  'kn.queries': 'الاستعلامات',
  'kn.grounded': 'المستندة إلى مصادر',
  'kn.tabSources': 'المصادر',
  'kn.tabQueries': 'الاستعلامات',
  'kn.noRecords': 'لا توجد سجلات بعد.',
  'kn.colKey': 'المعرّف',
  'kn.colTitle': 'العنوان',
  'kn.colType': 'النوع',
  'kn.colAuthority': 'مستوى الحجية',
  'kn.colRevision': 'الإصدار',
  'kn.colStatus': 'الحالة',
  'kn.colEffective': 'تاريخ السريان',
  'kn.colAsked': 'وقت السؤال',
  'kn.colQuestion': 'السؤال',
  'kn.colModel': 'النموذج',
  'kn.colGrounded': 'مستند إلى مصادر'
};
