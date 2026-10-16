// R1.2 Approvals screen messages. Arabic must have exactly the English keys. English text unchanged from the screen
// before translation; module and status codes through tv().
export const en = {
  'apr.eyebrow': 'DOA Workflow',
  'apr.title': 'Approvals',
  'apr.intro': 'Actions are locked to the logged-in user. The screen cannot send approver_id.',
  'apr.colId': 'ID',
  'apr.colModule': 'Module',
  'apr.colRecord': 'Record',
  'apr.colAmount': 'Amount',
  'apr.colStep': 'Step',
  'apr.colStatus': 'Status',
  'apr.colInitiatedBy': 'Initiated By',
  'apr.colAction': 'Action',
  'apr.approve': 'Approve',
  'apr.return': 'Return',
  'apr.reject': 'Reject',
  'apr.askRejectReason': 'Reason for rejection (at least 5 characters)',
  'apr.askReturnReason': 'Reason for return (at least 5 characters)',
  'apr.done': 'Approval #{id}: {action}',
  'apr.none': 'No approval instances.'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'apr.eyebrow': 'دورة صلاحيات الاعتماد',
  'apr.title': 'الاعتمادات',
  'apr.intro': 'الإجراءات مرتبطة بالمستخدم الذي سجّل الدخول؛ لا تستطيع الشاشة إرسال هوية معتمد آخر.',
  'apr.colId': 'الرقم',
  'apr.colModule': 'الوحدة',
  'apr.colRecord': 'السجل',
  'apr.colAmount': 'المبلغ',
  'apr.colStep': 'الخطوة',
  'apr.colStatus': 'الحالة',
  'apr.colInitiatedBy': 'بدأه',
  'apr.colAction': 'الإجراء',
  'apr.approve': 'اعتماد',
  'apr.return': 'إعادة للتعديل',
  'apr.reject': 'رفض',
  'apr.askRejectReason': 'سبب الرفض (5 أحرف على الأقل)',
  'apr.askReturnReason': 'سبب الإعادة للتعديل (5 أحرف على الأقل)',
  'apr.done': 'طلب الاعتماد رقم {id}: {action}',
  'apr.none': 'لا توجد طلبات اعتماد.'
};
