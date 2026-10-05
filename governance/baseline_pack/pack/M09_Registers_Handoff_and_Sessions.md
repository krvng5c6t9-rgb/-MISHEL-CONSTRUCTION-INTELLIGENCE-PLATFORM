# M09 — Registers, Handoff & Session Prompts
**Version:** v1.0.0 | مكان الحياة: مجلد `registers/` على Drive. الـ AI يقرأ ولا يعدّل؛ يطلّع النسخ المحدثة ملفًا واحدًا في كل رسالة وينتظر "كمّل".

## 1) السجلات
| # | الملف | الغرض |
|---|---|---|
| 01 | Requirement_Trace.csv | كل Requirement ← Capability ← WP ← كود/DB/API/UI/Workflow/Permission/Test/Evidence ← الحالة |
| 02 | Capability_Atlas.csv | قدرات الـ 4,965 وحالتها |
| 03 | Work_Package_Register.csv | 787 WP وحالاتها وإغلاقها |
| 04 | Code_Evidence_Register.csv | Artifact كود لكل دليل (ملف/جدول/endpoint/صفحة) |
| 05 | Test_Register.csv | Test IDs ونتائجها وأدلتها |
| 06 | Evidence_Register.csv | أدلة E1–E5 ومكانها وتاريخها |
| 07 | Gap_Register.csv | الفجوات وأولوياتها وTier |
| 08 | Issue_Register.csv | أخطاء وملاحظات المراجعة وإغلاقها |
| 09 | Decision_Register.csv | قرارات Owner والاعتراضات |
| 10 | Change_Control_Register.csv | Controlled Changes |
| 11 | Approval_Register.csv | قرارات Gates |
| 12 | Risk_Register.csv | المخاطر والإجراءات |
| 13 | Benchmark_Register.csv | مصفوفة المنافسين ومصادرها |
| 14 | Source_Register.csv | المصادر الخارجية |
| 15 | Compliance_Register.csv | متطلبات الامتثال المحلي |
| 16 | Event_Catalog.csv | الأحداث ومنتجوها ومستهلكوها |
| 17 | Output_Template_Register.csv | قوالب المخرجات (Output Factory) ونسخها |
| 18 | Slice_Register.csv | Prompt Slices وحالاتها ونتائجها |
| 19 | Pilot_Register.csv | عملاء/تجارب ونتائجها |
| 20 | Eval_Register.csv | تقييمات الـ AI |

## 2) قواعد التشغيل
1. معرّفات متسلسلة لا يعاد استخدامها (REQ-, CAP-, WP-, CE-, T-, E-, G-, I-, DEC-, CC-, A-, R-, B-, S-, C-, EV-, OT-, PS-, P-, EVL-).
2. كل صف: ID · Status (من الـ Taxonomy) · CreatedIn · LastUpdated · Notes.
3. لا حذف صفوف: الإلغاء بـ REJECTED/ARCHIVED مع سبب.
4. بداية الجلسة: قراءة Registers وHANDOFF وإعلان عدد الصفوف. نهايتها: النسخ المحدثة + قائمة التغييرات.
5. تعارض بين Register والواقع ⟵ Issue فورًا ولا يُحسم بالذاكرة.
6. فحص اتساق دوري: كل Evidence ID موجود · كل Requirement VERIFIED له Test PASS · كل Gate معتمد له Approval.

## 3) HANDOFF.md (قالب)
```
# HANDOFF — v_._._ — DATE: __
SESSION: S-__ | PHASE: P_ | GATE: G-__
## أين وصلنا (3 أسطر)
## ما تم (بالأرقام): فُحص x/y | Slices: x | Registers المحدثة: [اسم + نسخة]
## ما ثبت (E1) / ما COVERED فقط / UNVERIFIED
## Issues وGaps المفتوحة (Critical/Major أولًا)
## قرارات Owner المطلوبة (قرار | خيارات | توصية | سبب)
## ما اعترضت عليه وسبب (إن وجد)
## الخطوة التالية المصرّح بها
## تحذيرات للجلسة القادمة
```

## 4) قالب Gate Report
```
GATE: G-__ | PHASE: P_ | DATE | VERSION
SCOPE | INPUTS | WORK DONE | NOT DONE
EVIDENCE (IDs) | CONFLICTS | ISSUES (ID|Sev|حالة) | GAPS | RISKS
VERIFICATION PERFORMED (ما نُفِّذ فعلًا فقط)
ACCEPTANCE CRITERIA: [AC | Pass/Fail | Evidence]
RECOMMENDATION: PASS / CONDITIONAL / FAIL + السبب
OWNER DECISION: [ ] APPROVED [ ] REJECTED [ ] HOLD
NEXT AUTHORIZED STEP | CRITICAL/MAJOR OPEN: __ (لازم 0 للاعتماد)
```

## 5) رسائل الجلسات
**بداية:** `ابدأ. افتح HANDOFF والـ Registers من Drive وأعلن الحالة: (1) حالة الجلسة (2) عدد صفوف كل Register (3) المرحلة والـ Gate (4) أي تعارض. لا تبدأ العمل قبل "ابدأ".`
**نهاية:** `خلّص الجلسة: HANDOFF محدّث + كل Register اتغيّر كاملًا، ملف في كل رسالة، وانتظر "كمّل". اذكر اللي ما اتنفذش واللي UNVERIFIED.`
**تفويض مرحلة (مثال R0/Forensic):** `قرار Owner: نفّذ P_ بالترتيب بدون انتظار بين الدفعات. وقّف فقط عند: تعارض جوهري، Critical، ملف غير قابل للقراءة، نهاية الـ Gate. ردودك سطر واحد بعد كل دفعة.`
**تقدم Slice:** `نفّذ Prompt Slice PS-__ وفق M08 وأعد قالب الإرجاع كاملًا.`
**مراجعة Slice:** `راجع إرجاع PS-__ مقابل Acceptance وبروتوكول المراجعة (جولتان كحد أقصى)، وحدّث Registers.`
**تراجع الدقة:** عند طول المحادثة أو تكرار: `حدّث HANDOFF وقل: افتح محادثة جديدة واكتب ابدأ.`

## 6) الاستمرارية عبر المحادثات
التقدم الحقيقي في الملفات (Registers/HANDOFF/Evidence)، لا في المحادثة. محادثة جديدة تبدأ من HANDOFF. أي قرار يُكتب في Decision_Register في نفس الجلسة.
