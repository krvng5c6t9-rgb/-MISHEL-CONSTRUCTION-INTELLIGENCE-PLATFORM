# M08 — Prompt Slice & Coding Agent Protocol (بروتوكول التسليم لأداة البناء)
**Version:** v1.0.0 | ChatGPT في المحادثة يخطط ويكتب المواصفات ويراجع. تعديل الكود وتشغيل الاختبارات يتم بأداة تعمل داخل الريبو (Coding Agent) أو مبرمج. هذا البروتوكول هو الجسر.

## 1) مبادئ
1. **Slice صغيرة:** حتى 6 متطلبات من Work Package واحد. 2. **لا تخمين:** الملفات المراد تعديلها مثبتة من R0/Forensic. 3. **دليل راجع:** لا يُقبل «تم» بدون Logs واختبارات. 4. **تغيير مضبوط:** تعديل خارج المسموح = رفض. 5. **كل Slice تُغلق بتتبع** في Registers.

## 2) تسلسل التنفيذ لكل Slice
`DISCOVER → DESIGN → IMPLEMENT → TEST → HOSTILE → REMEDIATE → EVIDENCE/FREEZE`.
- DISCOVER: قراءة الكود الحالي ذي الصلة وتأكيد الحالة (COVERED/GAP).
- DESIGN: تغييرات DB/API/UI/Events/Permissions المخطط لها (مختصرة) وأثرها.
- IMPLEMENT: الكود والـ migrations بالحد الأدنى.
- TEST: الاختبارات المخططة (Test IDs) + سلبية.
- HOSTILE: محاولة كسر ما بُني (صلاحيات، تزامن، تكرار).
- REMEDIATE: إصلاح ما ظهر.
- EVIDENCE/FREEZE: Evidence Pack وحالة الـ Requirements.

## 3) قالب Prompt Slice
```
SLICE ID: PS-____ | WP: ____ | TIER: T_ | GLOBAL_TASK_ORDER: ____
REQUIREMENTS (حتى 6): [ID | نص مجمّد | Given/When/Then]
SOURCES: [Requirement/STEP ref]
VERIFIED CURRENT FILES (من R0): [مسارات ملفات/جداول/endpoints]
DEPENDENCIES / GATES: [Slices سابقة يجب أن تكون PASS]
ALLOWED EDITS: [مسارات مسموحة فقط]
FORBIDDEN: [أي شيء خارج المسموح، تغيير Baseline مجمّد، حذف بيانات]
STANDARDS: M03 (Architecture), M04 (Security), M05 (AI إن لزم)
ACCEPTANCE TESTS: [Test IDs + شروط النجاح]
STOP CONDITIONS: [متى تتوقف وتسأل: تعارض متطلبات، حاجة لتعديل خارج المسموح، فشل اختبار حرج]
OUTPUT REQUIRED: [قائمة تغييرات، Diff ملخص، نتائج اختبارات، Logs، حالة كل Requirement]
```

## 4) ما يعيده Coding Agent (Evidence Return)
```
SLICE: PS-____ | COMMIT/BRANCH: ____ | ENV: ____
CHANGED FILES: [..]
MIGRATIONS: [..] (من الصفر: PASS/FAIL)
BUILD: PASS/FAIL (Log)
TESTS: [Test ID | PASS/FAIL | ملاحظة] + إجمالي
NEGATIVE/HOSTILE: [النتائج]
REQUIREMENT STATUS: [ID | COVERED/VERIFIED/PARTIAL/GAP | دليل]
DEVIATIONS: [أي خروج عن الـ Slice وسببه]
OPEN ISSUES: [..]
```
ChatGPT يراجع الإرجاع مقابل Acceptance (بروتوكول المراجعة)، ثم يحدّث Registers.

## 5) قواعد الأمان في التنفيذ
لا أسرار في الكود أو الـ Logs · لا بيانات عملاء حقيقية في الاختبار · لا حذف بيانات · فرع منفصل لكل Slice · لا دمج بدون CI أخضر ومراجعة.

## 6) اختيار الأداة (قرار Owner)
خيارات: Coding Agent يعمل داخل الريبو (مثل Claude Code أو Codex أو ما يماثلها) · مبرمج بشري · خليط. المعيار: وصول للريبو، تشغيل الأوامر والاختبارات، قراءة الـ Logs، التعامل مع قاعدة بيانات محلية. `PENDING OWNER DECISION`.

## 7) حجم الدفعات والجدولة
- الترتيب من Global_Task_Order في الـ Register بعد P5.
- كل جلسة بناء = Slice واحدة أو أكثر داخل WP واحد، بحسب الحجم.
- Slice فشلت مرتين: تصعيد لـ Owner لمراجعة التصميم قبل المحاولة الثالثة.

## 8) معايير القبول للبروتوكول
- [ ] كل Slice بالقالب الكامل. [ ] كل إرجاع بالقالب الكامل مع Logs. [ ] لا تعديل خارج المسموح. [ ] Registers محدثة بعد كل Slice. [ ] لا إغلاق Requirement بلا اختبار.
