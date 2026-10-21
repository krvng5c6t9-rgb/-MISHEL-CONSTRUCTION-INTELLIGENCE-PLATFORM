// R1.2 HR / Payroll screen messages. Arabic must have exactly the English keys. English text unchanged from the screen
// before translation; payroll statuses through tv(); employment status through the screen's own keys (the shared
// codes "active" / "terminated" are worded for contracts). English shows the stored code, as tv() does.
export const en = {
  'hr.title': 'HR / Payroll',
  'hr.intro': 'Employees, attendance, timesheets, leave requests, payroll runs, and posting control.',
  'hr.employeesKpi': 'Employees',
  'hr.attendanceRows': 'Attendance Rows',
  'hr.payrollRunsKpi': 'Payroll Runs',
  'hr.employees': 'Employees',
  'hr.colCode': 'Code',
  'hr.colName': 'Name',
  'hr.colJob': 'Job',
  'hr.colStatus': 'Status',
  'hr.payrollRuns': 'Payroll Runs',
  'hr.colPeriod': 'Period',
  'hr.colTotal': 'Total',
  'hr.empActive': 'active',
  'hr.empOnLeave': 'on_leave',
  'hr.empTerminated': 'terminated'
} as const;

export const ar: Record<keyof typeof en, string> = {
  'hr.title': 'الموارد البشرية / المرتبات',
  'hr.intro': 'الموظفون، والحضور، وكشوف الوقت، وطلبات الإجازات، ودورات المرتبات، وضبط الترحيل.',
  'hr.employeesKpi': 'الموظفون',
  'hr.attendanceRows': 'سجلات الحضور',
  'hr.payrollRunsKpi': 'دورات المرتبات',
  'hr.employees': 'الموظفون',
  'hr.colCode': 'الكود',
  'hr.colName': 'الاسم',
  'hr.colJob': 'الوظيفة',
  'hr.colStatus': 'الحالة',
  'hr.payrollRuns': 'دورات المرتبات',
  'hr.colPeriod': 'الفترة',
  'hr.colTotal': 'الإجمالي',
  'hr.empActive': 'على رأس العمل',
  'hr.empOnLeave': 'في إجازة',
  'hr.empTerminated': 'انتهت خدمته'
};
