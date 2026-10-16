// R1.2 Cost Control screen messages. Arabic must have exactly the English keys. CC-072: the committed / actual /
// variance tiles are per currency (amounts in different currencies were added together before).
export const en = {
  'cost.eyebrow': 'Cost Ledger',
  'cost.title': 'Cost Control',
  'cost.intro': 'Append-only committed and actual cost transactions from approved procurement records.',
  'cost.committed': 'Committed ({currency})',
  'cost.actual': 'Actual ({currency})',
  'cost.variance': 'Variance ({currency})',
  'cost.colDate': 'Date',
  'cost.colProject': 'Project',
  'cost.colCostCode': 'Cost Code',
  'cost.colSource': 'Source',
  'cost.colType': 'Type',
  'cost.colAmount': 'Amount',
  'cost.colDescription': 'Description',
  'cost.none': 'No cost transactions yet.'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'cost.eyebrow': 'دفتر التكاليف',
  'cost.title': 'ضبط التكاليف',
  'cost.intro': 'حركات التكلفة الملتزم بها والفعلية من سجلات المشتريات المعتمدة، تُضاف ولا تُعدَّل.',
  'cost.committed': 'الملتزم به ({currency})',
  'cost.actual': 'الفعلي ({currency})',
  'cost.variance': 'الفرق ({currency})',
  'cost.colDate': 'التاريخ',
  'cost.colProject': 'المشروع',
  'cost.colCostCode': 'بند التكلفة',
  'cost.colSource': 'المصدر',
  'cost.colType': 'النوع',
  'cost.colAmount': 'المبلغ',
  'cost.colDescription': 'الوصف',
  'cost.none': 'لا توجد حركات تكلفة بعد.'
};
