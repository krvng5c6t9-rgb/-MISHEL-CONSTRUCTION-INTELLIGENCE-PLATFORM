# MISHEL — Expert Gap & Completion Plan v1.0 (خطة النواقص والاستكمال والتفوق)
**Status:** PROPOSED — OWNER APPROVAL PENDING | **يُقرأ بعد:** MASTER_PROJECT_DEFINITION ثم ADDENDUM_A1
**الغرض:** قائمة شاملة بما يحتاجه منتج يدير شركات مقاولات كبرى وينافس Odoo وSAP وOracle Primavera وProcore وAutodesk وMicrosoft Dynamics، مع طريقة إغلاق كل فجوة بدليل.

---
## 0) تعليمات للـ AI المنفذ (إلزامية)
1. **ابدأ من الـ Register، لا من هذا الملف.** كل بند هنا هو *فرضية فجوة*. قبل اعتماده: قارنه بالـ 4,602 متطلب (STEP17) والكود. الحالة: `COVERED / PARTIAL / GAP / N/A / DEFER` بدليل (Requirement ID + ملف/جدول/endpoint). ممنوع تصنيف بدون دليل.
2. **ممنوع ادعاء قدرة منافس بدون مصدر رسمي** (توثيق، صفحة منتج، Release notes) وتاريخ تحقق. أي معلومة عن منافس من الذاكرة = `UNVERIFIED`.
3. **ممنوع ادعاء تفوق.** الفرق في هذا الملف *فرضيات تميّز* تُختبر بقياس (البند 6).
4. **لا تبنِ ولا تعدّل كود** في هذه المرحلة. المخرجات: Registers وتقارير وخطط. ولا تغيّر Scope بدون Controlled Change.
5. **اعمل على دفعات.** لكل جلسة Domain واحد. سجّل النتائج في Registers وHANDOFF، وردّك أثناء الشغل سطر أو سطرين.
6. كل قرار تجاري/نشر/تسعير/فريق يذهب لـ Decision Sheet (A1 §3) ولا تقرره.
7. الامتثال المحلي (ضرائب، فاتورة إلكترونية، عمل، تأمينات، بيانات) = `PENDING EVIDENCE` من مصدر رسمي فقط.

---
## 1) فرضيات التميّز أمام المنافسين (تُختبر ولا تُسوَّق قبل إثباتها)
| # | الفرضية | كيف تُثبت |
|---|---|---|
| H1 | **Construction-native من الأساس:** BOQ وتكلفة وعقود ومستخلصات ومطالبات في Ledger واحد، لا Add-ons | E2E يعمل، وقياس عدد الأنظمة/الإدخالات المطلوبة مقابل إعداد Odoo/SAP نموذجي |
| H2 | **Digital Thread فعلي:** رسومات ← كميات ← BOQ ← تسعير ← Tender Package ← تكلفة فعلية | سيناريو Golden Flow على بيانات حقيقية، وقياس زمن ودقة |
| H3 | **AI محكوم:** Agents بصلاحيات محدودة وHITL وAudit وEvals على نفس بيانات الشركة | نتائج Evals على Golden Datasets، وسجل قرارات AI |
| H4 | **توطين MENA حقيقي:** عربي RTL، ممارسات التعاقد المحلية، الامتثال الضريبي والإلكتروني | Compliance Register مكتمل ومراجعة محلية |
| H5 | **إعداد بدون Fork (Mishel Brain):** الشركة تضبط الأدوار والإجراءات والقوالب بدون تعديل كود | تغيير إعدادات عميل ثم Upgrade بدون فقدها |
| H6 | **سرعة التطبيق عند العميل:** إعداد أسرع وتكلفة تنفيذ أقل من ERP عام | قياس أسابيع التطبيق في Pilot مقابل مرجع يحدده Owner |
| H7 | **تكلفة ملكية أقل** لشركات المقاولات المتوسطة/الكبيرة | نموذج TCO حقيقي بعد تحديد التسعير |

---
## 2) كتالوج الفجوات المحتملة (فرضيات لفحصها مقابل الـ Register)
> كل بند: ابحث عنه في 4,602 متطلب + الكود. لو غير موجود: `GAP` ثم أضفه لـ Gap_Register بأولوية.

### A) المالية والمحاسبة
Multi-currency وFX revaluation · Retention وAdvance Payment recovery · VAT/WHT وفق البلد · Revenue Recognition (نسبة الإنجاز/IFRS 15) · WIP وCost-to-Complete · Back-charges · Bank reconciliation · Cash-flow forecasting · Intercompany وConsolidation · Fixed Assets وDepreciation · Bonds & Guarantees وLC · Period close وReversal · Multi-GAAP عند الحاجة · Audit trail مالي.

### B) العقود والتجاري
مكتبة شروط (FIDIC وعقود محلية) · Notices وTime-bars وتنبيهاتها · Variation valuation · EOT/Claims وDelay analysis · Subcontract payment certificates (Retention/Back-charge) · Dispute log · Contract compliance matrix · Obligations tracking.

### C) المناقصات والتقدير والـ BD
CRM/Opportunity pipeline · Bid/No-bid scoring · Quantity Take-off (يدوي ومن رسومات) · Rate analysis وRate libraries · Supplier/subcontractor quotes comparison · Risk & contingency pricing · Tender Package assembly · Win/Loss analytics · Handover Tender→Project (Budget/Baseline) .

### D) المشتريات وسلسلة الإمداد
Vendor prequalification وتقييم · RFQ/Tender analysis · PO وCall-off · GRN وThree-way match · Stores/Inventory وTransfers · Import/Logistics/Customs (حسب النشاط) · Material approvals (MAR) · Price intelligence.

### E) التخطيط والتحكم
استيراد/تصدير Primavera/MSP · Baselines وUpdates · CPM وDelay analysis (TIA) · Resource/Cost loading · EVM وS-Curves · Look-ahead · 4D linking · Productivity norms · Recovery plans.

### F) الموقع والتنفيذ
Daily reports · Manpower/Equipment logs · Material receiving · Progress measurement (QS vs Planning) · Photos مع Geotag · Mobile/Offline · Work packaging · Temporary works · Snag/Punch · Handover وWarranty.

### G) الجودة والسلامة
ITP وInspection Requests · NCR/CAPA · Test registers (خرسانة، وغيرها) · Permits-to-work · Incident/Near-miss · Toolbox talks · Audits · HSE KPIs.

### H) الموارد البشرية
Attendance وTimesheets · Payroll (حسب البلد) · Camp/Housing/Transport (حسب النشاط) · End-of-service · Competency/Training · Subcontractor labor compliance.

### I) المكتب الفني ومراقبة الوثائق (CDE)
Submittals/Shop Drawings workflows · RFIs · Transmittals · Revisions · Markup/Review · Naming standards (ISO 19650-style) · Correspondence وTime-bars · Meeting minutes وActions · Interface management.

### J) BIM والهندسة
IFC/Model viewer · Model-based quantities · Clash/Issue linking · GIS/Reality capture (تكامل) · Engineering Rules/Calculation engines (بتحقق) · Standards/Codes governance.

### K) AI والأتمتة
Drawing/Contract/BOQ understanding · Project memory (RAG) بصلاحيات · Agent Factory وToolcalling محكوم · Evals وGolden datasets · Cost/Token governance · Kill switch · n8n/Webhooks/MCP ككبسولات تكامل · Explainability.

### L) المنصة والأمان
Multi-tenant isolation (مُثبت runtime) · RBAC/ABAC/DOA/SoD · SSO (SAML/OIDC) وMFA · Workflow/BPM · Low-code metadata · Reporting/BI وSemantic layer · APIs/Webhooks · Import/Migration tools · Observability · Backup/DR · Data residency · Encryption · Pen-test · Supply-chain security · Upgrade/Rollback.

### M) التجاري للمنتج (SaaS)
Subscriptions/Licensing/Entitlements · Metering وBilling · Trial/Provisioning · White-label · Support/SLA · Documentation وTraining · Partner/Implementation programme · Customer success · Release channels.

---
## 3) نموذج تقييم الفجوات (الأوزان يحددها Owner)
لكل فجوة: **Customer Value** (1-5) · **Revenue/Deal Impact** (1-5) · **Differentiation vs Incumbents** (1-5) · **Dependency Weight** (كم Domain يتوقف عليها) · **Effort** (S/M/L/XL) · **Risk** (1-5) · **Evidence Quality**.
Priority = (Value + Revenue + Differentiation + Dependency) ÷ (Effort + Risk) — يعدل Owner المعادلة. المخرج: ترتيب P0/P1/P2 مرتبط بـ Tiers (A1 §2).

---
## 4) طريقة العمل (Work Plan لـ ChatGPT)
| Step | المهمة | المخرج | شرط الإغلاق |
|---|---|---|---|
| S1 | مطابقة كتالوج البند 2 مع Register الـ 4,602 | Coverage Matrix: بند ← Requirement IDs ← الحالة | كل بند له حالة بدليل |
| S2 | إضافة الفجوات الجديدة لـ Gap_Register | Gap IDs بأولوية | لا تكرار مع Register |
| S3 | Benchmark المنافسين من مصادر رسمية | Competitor Capability Matrix بمصدر وتاريخ | كل خانة بمصدر أو `UNVERIFIED` |
| S4 | تحديد فرق التميّز الحقيقي (أين نتفوق/نتعادل/نتأخر) | Differentiation Map | بدون ادعاء بلا مقياس |
| S5 | تقييم وترتيب الفجوات | Prioritized Backlog | معادلة معتمدة من Owner |
| S6 | تقسيم لـ Work Packages وTiers | Plan مرتبط بـ A1 | كل WP له Acceptance |
| S7 | خطة Golden Flows والقياس | Test & Benchmark Plan | معايير نجاح بأرقام يضعها Owner |
| S8 | Gate Report | تقرير واحد | قرار Owner |

---
## 5) Golden Flows للإثبات التنافسي (سيناريوهات عرض وقياس)
1. **Tender-to-Package:** ملفات تندر ← مراجعة رسومات ← كميات وخامات ← مطابقة BOQ ← تسعير ← Tender Package ← تنبيه ما بعد الترسية. *يُقاس:* الزمن، دقة الكميات، الأخطاء، تدخل البشر.
2. **Procure-to-Pay:** PR ← RFQ ← PO ← GRN ← Invoice ← Cost ← GL ← Payment. *يُقاس:* زمن الدورة، أخطاء المطابقة، التكرار.
3. **Subcontract-to-IPC:** عقد ← تقدم ← مستخلص ← Retention/Back-charge ← دفع. *يُقاس:* زمن الإقفال، دقة الخصومات.
4. **Plan-to-Control:** Baseline ← تحديث ← EVM ← تأخير ← مطالبة. *يُقاس:* اتساق الأرقام بين التخطيط والتكلفة.
5. **Claim-to-Evidence:** حدث ← إخطار في الميعاد ← أدلة ← قيمة ← متابعة.
6. **Site-to-Dashboard:** تقرير يومي ← تقدم ← KPIs للإدارة.
لكل Flow: بيانات حقيقية سابقة (مُجهَّلة) + نتيجة مرجعية معروفة + معايير نجاح يحددها Owner.

---
## 6) مخاطر الفشل (وكيف تُحجَّم)
| الخطر | الإجراء |
|---|---|
| تضخم التوثيق أكبر من الكود | مقياس التقدم = كود شغال + اختبار + Runtime Evidence فقط |
| نطاق ضخم دون أولويات | Tiers + قرار DEFER + Decision Sheet |
| دقة AI في الرسومات/الأسعار | Golden Datasets + Human approval + حدود قبول |
| الأمان وعزل العملاء | اختبارات سلبية Runtime قبل أي عميل |
| فشل التطبيق عند العميل | منهجية تنفيذ وتدريب وPilot قبل البيع الواسع |
| الاعتماد على شخص/أداة واحدة | توثيق وHandoff وRegisters خارج المحادثات |
| الامتثال المحلي | Compliance Register ومراجعة محلية |
| ادعاءات تسويقية غير مثبتة | لا Claim بلا Evidence |

---
## 7) مخرجات مطلوبة من ChatGPT (بالترتيب)
1. Coverage Matrix (S1) لكل مجموعة من A إلى M، مجموعة في كل جلسة.
2. Gap_Register محدّث.
3. Competitor Capability Matrix (مصادر رسمية فقط).
4. Differentiation Map وPrioritized Backlog.
5. Test & Benchmark Plan للـ Golden Flows.
6. Gate Report يطلب قرار Owner على: Tiers، الأوزان، الـ Golden Flows، الأسئلة D1–D9.
**ممنوع:** FINAL/PRODUCTION READY/تفوق على منافس قبل الأدلة.

---
## 8) بنود استكمال إضافية (تُنفَّذ مع S1–S8 ويُعاد ترتيبها في S5)

### 8.1) البساطة كمتطلب قابل للقياس (Simplicity Requirements)
**المبدأ:** المنتج واسع داخليًا وبسيط على المستخدم. البساطة تُصمَّم وتُقاس، ولا تُفترض.
| المقياس | الصيغة | الهدف |
|---|---|---|
| زمن أول قيمة | من إنشاء الحساب لأول عمل مفيد | يحدده Owner (اقتراح للمناقشة: دقائق، لا أيام) |
| عدد الخطوات | لإنجاز المهام الحرجة (مستخلص، PR، تقرير يومي، اعتماد) | يحدده Owner لكل مهمة |
| ظهور الوظائف | المستخدم يرى ما يخص دوره فقط | Role-based UI لكل دور |
| إعداد الشركة | تشغيل شركة جديدة بقوالب جاهزة | Setup Wizard وTemplates حسب نوع الشركة |
| الإدخال المتكرر | كل بيان يُدخل مرة واحدة | Zero double-entry بين الأقسام |
| الربط الآلي | الأحداث تنتقل بين الأقسام تلقائيًا | قواعد ربط وAudit لكل انتقال |
**المخرج:** UX Requirements Register: لكل Persona (مالك، مدير مشروع، مهندس موقع، QS، محاسب، مشتريات، مخازن، مكتب فني، جودة، سلامة، HR) أهم 5 مهام + مقياس نجاح. القيم الرقمية يعتمدها Owner بعد تجربة مستخدمين.

### 8.2) مبدأ الربط التلقائي بين الأقسام (Integration-by-Design)
- مصدر حقيقة واحد لكل كيان (Project, BOQ Item, PO, Cost Transaction…) والأقسام الأخرى تقرأ منه.
- الأحداث: كل تغيير جوهري يولّد Event (Idempotent + Audit) يستهلكه القسم التالي (مثال: GRN ← تحديث مخزون ← Cost Transaction ← تأثير على Cost-to-Complete ← تنبيه).
- **مخرج مطلوب:** Event Catalog (Event ← المنتج ← المستهلكون ← الأثر المالي/التعاقدي) وMatrix للربط بين الأقسام، ويُقارن بالـ Register والكود.
- الـ AI Agents وChatbots وn8n والتكاملات الخارجية تتصل عبر نفس طبقة الأحداث والصلاحيات، وليس بقنوات جانبية.

### 8.3) خطة العميل التجريبي (Pilot & Validation Plan)
المخرج: وثيقة Pilot تحتوي: نوع العميل المقترح (حسب D1) · النطاق (Golden Flow واحد أو اثنين) · البيانات (مُجهَّلة أو فعلية بإذن) · الأدوار المشاركة · مدة التجربة · مقاييس النجاح قبل/بعد (وقت، أخطاء، رضا، استعداد للدفع) · خطة جمع الملاحظات · معايير Go/No-Go للتوسع. المقاييس الرقمية يحددها Owner.

### 8.4) خطة الطرح والتنفيذ والدعم (Go-to-Market & Delivery) — هيكل للـ Owner
شرائح العملاء · عرض القيمة لكل شريحة · التسعير والترخيص (حسب D6) · قنوات البيع · الشراكات وشركاء التنفيذ · منهجية التطبيق عند العميل (مراحل، أدوار، مدة) · الترحيل من الأنظمة القديمة · التدريب والمواد · الدعم وSLA · Customer Success · خطة الإصدارات والتحديثات. كل بند `PENDING OWNER DECISION`، ويقدم الـ AI خيارات وتوصية.

### 8.5) تقدير الموارد والزمن (Estimation)
بعد S1 وS5، يعدّ الـ AI **تقديرًا أوليًا** مبنيًا على الـ Backlog: عدد الـ WPs لكل Tier ومستوى الجهد، مع افتراضات معلنة (حجم الفريق، الإنتاجية). يُسمى `ESTIMATE` ولا يُقدَّم كالتزام. الإنتاجية الفعلية تُعاير من نتائج أول WPs منفذة.

### 8.6) القانوني والملكية الفكرية والبيانات
ترخيص المنتج وشروط الاستخدام · ملكية بيانات العميل وتصديرها · الخصوصية وحماية البيانات والاستضافة · مسؤولية مخرجات الـ AI والقيود المهنية · استخدام مكتبات مفتوحة المصدر وتراخيصها (SBOM) · استخدام أسماء وعلامات المنافسين في التسويق. كلها تحتاج مراجع قانوني، وتسجَّل `PENDING EVIDENCE`.

### 8.7) تحديث خطوات العمل
أضف للبند 4: **S9** UX Requirements Register (8.1) · **S10** Event Catalog (8.2) · **S11** Pilot Plan (8.3) · **S12** GTM & Estimation Skeleton (8.4–8.5) · **S13** Legal Checklist (8.6). كل خطوة بمخرج وGate قبل الانتقال.

### 8.8) تحديث المخرجات المطلوبة (البند 7)
أضف: UX Requirements Register · Event Catalog وIntegration Matrix · Pilot Plan · GTM Skeleton · Estimation Sheet · Legal Checklist.

---
## 9) الإنتاج الديناميكي من مثال: Example-to-Template Output Factory (متطلب أساسي)

### 9.1) الفكرة
المستخدم يعلّم النظام شكل المخرج **مرة واحدة بمثال**، وبعدها يطلب بجملة عادية ("اعمل مقايسة المشروع"، "اعمل التندر"، "اعمل الـ Lookahead"، "اعمل المستخلص"...) فيُنتَج المخرج من بيانات المشروع الفعلية بنفس الشكل والمعايير.

### 9.2) المخرجات المستهدفة (أمثلة، قابلة للتوسع)
BOQ/المقايسة · Tender Package · الجدول الزمني · Lookahead (أسبوعين/ثلاثة) · Cash Flow · المستخلص (IPC) · قائمة المقاولين/الموردين · عقد مقاول باطن · RFQ ومقارنة العروض · التقرير اليومي/الأسبوعي/الشهري · Method Statement · محاضر · خطابات ومراسلات.

### 9.3) دورة العمل
1. **Teach:** يرفع Owner/المستخدم المثال (ملف أو أكثر) + وصف شفهي للقواعد (ترقيم، وحدات، طريقة التوصيف، المعادلات، التنسيق).
2. **Extract:** يستخرج النظام *Template Draft*: الحقول، البنية، الترقيم، قواعد التوصيف، المعادلات، الأنماط، والاستثناءات.
3. **Confirm:** يعرض Draft للمراجعة والتعديل. لا يُفعَّل قبل اعتماد المستخدم المسؤول.
4. **Store:** يُحفظ كقالب **Versioned** في Mishel Brain (على مستوى الشركة، مع تخصيص مشروع/عميل).
5. **Generate:** عند الطلب، يحدد النظام (Intent → Workflow + Template + Data Scope)، ويتأكد من توفر البيانات اللازمة. **لو ناقصة، يقول ما الناقص بدل ما يخترع.**
6. **Validate:** قواعد حتمية (حسابات، وحدات، تطابق مع البيانات) ثم مراجعة بشرية/اعتماد حسب DOA.
7. **Issue & Audit:** إصدار مضبوط بنسخة، وكل سطر مرتبط بمصدره، وسجل تغييرات.

### 9.4) قواعد جودة إلزامية
- **الحقائق من قاعدة البيانات، لا من الـ AI.** الـ AI يصيغ ويقترح التوصيف ويشرح، لكن الكميات والأسعار والتواريخ والمبالغ تأتي من المصدر المعتمد أو من القواعد الحتمية.
- **قابلية التكرار:** نفس البيانات + نفس القالب = نفس المخرج (الأجزاء الحتمية).
- **تعدد الأمثلة:** إضافة مثال جديد يحدّث القالب بنسخة جديدة، وأي تعارض بين الأمثلة يُعرض ولا يُحسم تلقائيًا.
- **Traceability:** لكل سطر/رقم: مصدره والقاعدة التي أنتجته.
- **التحكم بالتغيير:** تعديل قالب معتمد = نسخة جديدة وإعادة اعتماد، والمخرجات القديمة تحتفظ بنسخة القالب التي أُنتجت بها.
- **الصلاحيات:** من يعلّم/يعتمد/يولّد/يصدر تُحدَّد بالدور (Maker/Checker).
- **حدود الاستنتاج:** المخرجات التي تعتمد على حكم هندسي (منطق جدول زمني، تسعير، خطة تنفيذ) تحتاج قواعد + بيانات إنتاجية + مراجعة بشرية، ولا تُقدَّم كنهائية.

### 9.5) اختبار القبول (لكل مخرج في 9.2)
1. **Teach once:** مثال واحد معتمد من Owner.
2. **Generate on a second project:** تشغيل على بيانات مشروع مختلف.
3. **Reference compare:** مقارنة المخرج بنسخة أُعدت يدويًا من خبير (حقل بحقل، رقم برقم).
4. **Metrics (يحددها Owner):** نسبة تطابق البنية، دقة الأرقام، عدد التعديلات اليدوية المطلوبة، الزمن مقابل الإعداد اليدوي.
5. **Failure cases:** بيانات ناقصة، أمثلة متعارضة، وحدات مختلفة. المطلوب إعلان الخطأ لا تغطيته.
6. تسجيل النتائج في Evals Register، ولا يُعلن المخرج "مدعومًا" قبل اجتياز المعايير.

### 9.6) مخرجات مطلوبة من ChatGPT لهذا البند
- **Output Catalog:** كل مخرج (9.2) ← بياناته المصدرية ← قواعده الحتمية ← ما يحتاج حكمًا بشريًا ← الموجود في Register/الكود.
- **Template Model:** تعريف بنية القالب (حقول، قواعد، معادلات، نسخ، صلاحيات) ومقارنته بما في الكود.
- **Teach-Generate Spec:** سيناريو تفصيلي لكل مخرج من 9.2 (مثال تعليم ← طلب ← توليد ← تحقق).
- **Gap list:** ما ينقص الكود/الـ Register لدعم ذلك.
أضف إلى البند 8.7: **S14** Output Factory Catalog + Template Model + Test Plan (9.6).
