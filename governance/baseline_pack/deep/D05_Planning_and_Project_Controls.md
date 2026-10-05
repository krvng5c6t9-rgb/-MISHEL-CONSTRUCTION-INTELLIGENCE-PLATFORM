# D05 — Planning & Project Controls (التخطيط والتحكم في المشاريع)
**Template:** MISHEL_MODULE_DEEP_DIVE_TEMPLATE v1.0 | **Version:** v1.0.0 | **Depth:** D5 (هدف) | **الحالة:** `SPEC DRAFT — لم يُقارَن بالكود بعد` (كل حالة UNKNOWN حتى R0/Forensic)
**ملاحظات:** يشمل الجدول الزمني (CPM)، الموارد، التقدم، القيمة المكتسبة (EVM)، Look-ahead، التدفق النقدي، وتحليل التأخير. الاعتماد على Primavera/MSP قائم في السوق، فالمنتج يستورد ويصدّر ويحاكي ما يلزم لكن **لا يدّعي استبدالها قبل قياس**. المعادلات والمعايير (طرق EVM، فحوص جودة الجدول، طرق تحليل التأخير) تُعامَل كمراجع بإصدار ومصدر `PENDING EVIDENCE`، والعتبات أمثلة قابلة للإعداد.

## 1) الهوية
- **الاسم:** Planning & Project Controls · **العائلة:** Time & Performance Control · **Tier:** T1 · **المالك:** Planning Manager + Platform Architect
- **يعتمد على:** D01، D03 (BOQ/موارد/كميات)، D04 (تواريخ تعاقدية/EOT)، D08 (تقدم ميداني)، D11/D12 (موارد).
- **يغذي:** D04 (تحليل التأخير)، D06 (مواعيد احتياج)، D07 (تقدم الباطن)، D13 (تدفق نقدي، إيراد)، D18.
- **IDs:** `REQ-PLN-*`, `WP-PLN-*`.

## 2) الغرض والمستخدمون
**المشكلة:** الجدول غالبًا ملف Primavera معزول عن التكلفة والكميات والمشتريات؛ تحديثه شهري يدوي، والتقدم يُقدَّر بالنظر، والانحراف يُكتشف متأخرًا، وLook-ahead يُكتب في Excel، والتدفق النقدي تخمين. المطلوب جدول حي مرتبط بالكميات والتكلفة والتوريد والتقدم الفعلي.
| Persona | أهم المهام |
|---|---|
| مدير التخطيط | الجدول الأساس والتحديثات والمسار الحرج |
| مخطط الموقع | Look-ahead أسبوعي وتنسيق الفرق |
| مهندس التحكم (Cost/Controls) | EVM، الانحرافات، التنبؤ |
| مدير المشروع | حالة المشروع والقرارات التصحيحية |
| مهندس الموقع | تحديث التقدم اليومي |
| مشتريات | تواريخ الاحتياج |
| مدير العقود | تحليل التأخير وEOT |
| مالي | التدفق النقدي المتوقع |
| الإدارة العليا | صحة المحفظة |
**مقياس النجاح (Owner):** دقة التنبؤ بتاريخ الإنجاز · زمن تحديث الجدول · نسبة الأنشطة المرتبطة بكميات وتكلفة · عدد الأنشطة المتأخرة المكتشفة مبكرًا · دقة Look-ahead (PPC).

## 3) السيناريوهات (Given/When/Then)
**S1 — بناء الجدول من BOQ:** BOQ ← WBS ← أنشطة بكميات وموارد وإنتاجيات (D03) ← مدد محسوبة ← علاقات من قوالب منطق (تتابع الأعمال) ← CPM ← جدول مبدئي (يظهر المسار الحرج).
**S2 — استيراد جدول Primavera/MSP:** XER/XML/MPP ← مطابقة الأنشطة مع WBS/BOQ بدرجة تشابه ← تقرير تعارضات (أنشطة بلا كمية، بنود بلا نشاط) ← اعتماد.
**S3 — الجدول الأساس (Baseline):** تجميد نسخة معتمدة (Baseline 0)، وإنشاء Baselines إضافية بعد EOT/VO معتمدة مع سجل سبب.
**S4 — تحديث التقدم:** من الموقع (D08): كميات منفذة يومية ← نسب تقدم أنشطة تلقائيًا بقواعد (Steps/Units/Duration%) ← تحديث الجدول (Status Date) ← CPM جديد ← الفرق عن الأساس.
**S5 — Look-ahead:** 2/3/6 أسابيع قادمة من الجدول، مع قيود (مواد، معدات، عمالة، تصاريح، تسليم رسومات) وحالة جاهزية كل نشاط (Make-Ready) وPPC أسبوعي.
**S6 — القيمة المكتسبة (EVM):** PV/EV/AC بحسب أنشطة/بنود، CPI/SPI، EAC/ETC بطرق قابلة للاختيار، تنبؤ بتاريخ ومبلغ الإنجاز.
**S7 — التدفق النقدي:** من الجدول والكميات والأسعار والدفعات (D04) والمحتجز وآجال الدفع للموردين والباطن (D06/D07) ← تدفق داخل/خارج متوقع، حساسية (What-if).
**S8 — محاكاة (What-if):** تعديل منطق/مدد/موارد أو إسراع (Crashing/Fast-tracking) ومقارنة التأثير على التاريخ والتكلفة.
**S9 — تحليل التأخير:** من جداول محدثة (As-planned/As-built/Windows…) ← تحديد أثر الأحداث (D04) على المسار الحرج ← مخرجات لأغراض EOT/مطالبة، مع توثيق الطريقة.
**S10 — محفظة (Multi-project):** موارد مشتركة، تعارض تحميل بين مشاريع، لوحة محفظة.
**الحالات الحدية:** أنشطة بقيود تواريخ (Must Start On..)، علاقات بإبطاء/تقديم (Lag/Lead)، تقاويم متعددة (طقس، ورديات، عطلات)، أنشطة غير مرتبطة (Dangling)، دورات منطقية (Loops)، تغير نطاق، أنشطة LOE، تقدم يتجاوز 100%، كمية منفذة بلا نشاط، تقدم بالسالب، أنشطة متعددة لبند BOQ واحد وعكسه.

## 4) نموذج البيانات
| الكيان | سمات رئيسية | SoT |
|---|---|---|
| Schedule | project, name, type (baseline/working/what-if/updated), version, status_date, calendar_default, source (native/imported), parent_baseline | PLN |
| WBS | project, parent, code, name, level, owner, weight | D01/PLN |
| Activity | schedule, wbs, code, name, type (task/milestone/LOE/WBS summary), duration_orig/remaining, start/finish (planned/early/late/actual), float (total/free), constraint, calendar, % complete (type), status | PLN |
| Relationship | pred, succ, type (FS/SS/FF/SF), lag, calendar | PLN |
| Calendar | work-week, exceptions, holidays, shifts, weather rules | PLN/D01 |
| ActivityResourceAssignment | activity, resource, units/day, qty, cost | PLN ↔ D03/D11/D12 |
| ActivityBOQLink | activity, boq_item, weight, quantity_share | PLN ↔ D03 |
| ProgressRecord | activity/boq_item, date, quantity_done, source (site report/inspection/measurement), approved_by, evidence | PLN ↔ D08 |
| Baseline | schedule snapshot (full), reason, approved_by | PLN |
| Constraint/Readiness (Make-Ready) | activity, constraint type (materials/design/equipment/labor/permit), owner, due, status | PLN |
| EVMSnapshot | project/WBS, date, PV, EV, AC, CPI, SPI, EAC, ETC, method | PLN ↔ D13 |
| CashflowForecast | project, scenario, period, inflow, outflow, cumulative, assumptions | PLN ↔ D13 |
| DelayEvent | schedule, event_ref (D04), window, critical_impact_days, responsibility, method | PLN ↔ D04 |
| Risk-on-schedule | activity, risk, duration_range, probability | PLN ↔ D17 |
**قواعد:** كل Schedule نسخة مجمّدة قابلة للمقارنة (Snapshot) · Baseline لا يتغير بصمت (Controlled Change مع رقم VO/EOT) · الهوية الثابتة للنشاط عبر النسخ (stable_activity_id) · تقدم الأنشطة يُشتق من التقدم الفعلي للكميات المعتمد وليس من إدخال حر إلا باستثناء موثق · الوقت بالتوقيت المحلي للمشروع مع خزن UTC.

## 5) دورة الحياة والـ Workflow
- **Schedule:** `Draft → Reviewed → Approved → Baselined → Updated(periodic) → Superseded`.
- **Progress:** `Reported(site) → Verified(engineer) → Approved(PM) → Applied`.
- **Look-ahead:** `Proposed → Constraint Review → Committed → Executed → PPC computed`.
- **Baseline Change:** `Requested → Justified (VO/EOT) → Approved → New Baseline`.
- **اعتمادات (قابلة للإعداد):** اعتماد الجدول الأساس (PM + مدير التخطيط + تعاقدي)، تحديث شهري يُعتمد قبل الإرسال للعميل، التقدم المؤثر على الفوترة (D07/D13) بتحقق ثانٍ.
- **SLA:** موعد إغلاق تحديث الأسبوع/الشهر، تنبيه تأخر الإدخال، تصعيد لمدير المشروع.
- **التراجع:** إعادة نسخة سابقة بنسخة جديدة.

## 6) الصلاحيات
- مخطط/مهندس موقع: يدخل التقدم لمشروعه فقط. اعتماد التقدم لا يتم بنفس المدخل (SoD).
- الجدول الأساس والتحليلات (Delay) مقيدة (تعاقدي حساس).
- التدفق النقدي والـ EAC حساسان: الإدارة والمالية والتحكم.
- مشاركة الجدول مع العميل/الاستشاري: عرض/تصدير مقيد بنسخة معتمدة فقط.
- تدقيق أي تعديل على نشاط/علاقة/Baseline.

## 7) الأحداث والربط التلقائي
**منتج:** `schedule.baselined/updated` · `progress.approved` · `activity.delayed_critical` · `lookahead.committed` · `evm.snapshot_created` · `cashflow.forecast_updated` · `delay_event.analyzed`.
**أثر:** `progress.approved` ← يحدّث نسب الأنشطة والقيمة المكتسبة، ويغذي المستخلص (D07/D13) · `activity.delayed_critical` ← تنبيه PM + اقتراح إخطار (D04) · أي تغيير في مواعيد الاحتياج ← تحديث تواريخ المشتريات (D06) وتنبيه الموردين · `vo.approved`/`eot.granted` (D04) ← مقترح تعديل Baseline · `cashflow.forecast_updated` ← الخزينة (D13).

## 8) الواجهات البرمجية
`/v1/schedules`, `/activities`, `/relationships`, `/calendars`, `/baselines`, `/progress`, `/lookahead`, `/evm`, `/cashflow`, `/delay-analysis`, `/schedules/{id}/compare`. استيراد/تصدير XER/XML/MPP/CSV بـ Job. حساب CPM كخدمة (على الخادم) تقبل الجدول كاملًا أو الفرق (تزايدي). Webhooks. MCP: أنشطة حرجة، نشاط → كمية → تكلفة. Idempotency وETag.

## 9) الواجهة (UX)
- **Gantt** تفاعلي (سحب/إسقاط، ربط، Zoom، مستويات WBS، مسار حرج بالألوان، Baseline ظل) بأداء جيد حتى 50k نشاط.
- **Network Diagram** اختياري، **Histogram الموارد**، **S-Curve** (مخطط/فعلي/تنبؤ)، لوحة EVM.
- **Look-ahead Board:** أسبوع بأسبوع، حالة الجاهزية، مسؤول القيد، حسم بالسحب.
- **شاشة التقدم الميداني** بسيطة جدًا (موبايل/Offline): النشاط، الكمية المنفذة، صور، توقيع.
- مقارنة نسخ (Baseline vs Current) مع مسببات الاختلاف.
- RTL/LTR، تقويم هجري/ميلادي اختياري، طباعة بأحجام A3/A1.

## 10) القواعد والحسابات
- **CPM:** Forward/Backward pass مع التقاويم والعلاقات الأربع والـ Lag/Lead والقيود؛ Total/Free Float؛ كشف الدورات. تُوثَّق الخوارزمية والاختلافات المقبولة مع Primavera (مثل طريقة حساب Float والمسار الحرج: Longest Path vs Total Float ≤ 0) ويُختار بالإعداد.
- **نسبة الإنجاز:** حسب النوع: Physical (من كميات BOQ بوزن)، Duration، Units، Steps (مراحل بأوزان). قاعدة تحويل تقدم BOQ إلى تقدم نشاط تعتمد على ActivityBOQLink وأوزان.
- **EVM:** EV = % إنجاز × BAC (بحسب Granularity)؛ SPI=EV/PV؛ CPI=EV/AC؛ EAC بطرق (BAC/CPI، AC+(BAC−EV)، AC+(BAC−EV)/(CPI×SPI)) قابلة للاختيار. **Earned Schedule** اختياري. (الصيغ مرجعية، تُراجع.)
- **Cashflow:** تكلفة موزعة زمنيًا بحسب نوع (مواد عند الاستلام، عمالة شهرية، باطن بالمستخلصات) + آجال دفع، وإيراد بحسب مراحل التقدم والدفعات والمحتجز.
- **PPC** = أنشطة أنجزت كما التزم ÷ الملتزم.
- **جودة الجدول:** فحوص (أنشطة بلا سابق/لاحق، علاقات SF، Lag سالب، قيود صلبة، مدد طويلة، float مرتفع، أنشطة بلا موارد) بقواعد وعتبات قابلة للإعداد (مرجعها ممارسات DCMA-like `UNVERIFIED` حتى التحقق).
- حتمية بالكود. الـ AI يقترح ولا يحسب.

## 11) المخرجات والتقارير (Output Factory)
Gantt/Bar chart بقالب الشركة أو العميل · Look-ahead أسبوعي · تقرير تقدم شهري (جدول، S-curve، انحرافات، مخاطر) · EVM Report · Cashflow Forecast · Resource Histogram · تقرير تحليل التأخير · مقارنة Baseline · جودة الجدول (Schedule Health) · ملخص تنفيذي للعميل.
**علّم مرة ثم ولّد:** يُرفع تقرير تقدم شهري سابق ← يستخرج النظام هيكله وجداوله ورسومه وصياغته ← قالب ← يولّد تقرير الشهر الجديد من البيانات ويكتب الشرح بمسودة تُراجع. نفس آلية D03 (Example-to-Template).

## 12) التكاملات
- **Primavera P6:** استيراد/تصدير XER (وXML) مع Mapping كامل (أنشطة، علاقات، موارد، تقاويم، Baselines، Codes، UDFs)، ومطابقة الفروق بعد التبادل؛ اتجاه ثنائي بحذر (من هو المصدر الأساس؟ قرار Owner).
- **MS Project:** MPP/XML.
- **Excel:** Look-ahead، تقدم، موارد.
- **Revit/Navisworks (4D):** ربط أنشطة بعناصر النموذج (مرحلة لاحقة).
- **D08 (الموقع) وتطبيق الموبايل:** تقدم يومي.
- **SAP/Odoo/محاسبة:** ميزانية وتكلفة فعلية للمقارنة.
- لكل تكامل: Mapping، اختبار تطابق، معالجة الأخطاء.

## 13) الذكاء الاصطناعي
- **Schedule Generator:** يقترح أنشطة وعلاقات من BOQ وقوالب مشاريع سابقة ويشرح الافتراضات؛ المخطط يعتمد.
- **Schedule Reviewer:** يفحص الجودة (§10) ويقترح إصلاحات، ويقارن بمشاريع مشابهة (مدد شاذة).
- **Progress Assistant:** يلخص تقارير الموقع ويقترح تحديثات تقدم، التأكيد بشري.
- **Delay Predictor:** يتنبأ بالأنشطة المعرضة للتأخير بناءً على التقدم والموارد والتوريد؛ إشارة احتمالية لا قرار.
- **Look-ahead Coach:** يحدد القيود الناقصة ويقترح مسؤولين.
- **Report Writer:** يصيغ شرح التقرير من البيانات؛ الأرقام من الداتابيز.
- **Evals:** جداول مرجعية بمسارات حرجة معروفة، تقدم تاريخي مع انحرافات معروفة: دقة اكتشاف المشكلات، دقة التنبؤ. حدود القبول من Owner.
- **Autonomy:** Shadow ← Assist. لا Act على تعديل Baseline أو التقدم المعتمد.

## 14) العالمية والامتثال (`PENDING EVIDENCE`)
- تقاويم العمل والعطلات الرسمية والأجازات الدينية لكل دولة (Country Pack).
- متطلبات عقود وتقارير العملاء الحكوميين وصيغ تقدمها.
- التنسيقات الرقمية، اللغة، الاتجاه.
- معايير الجدول والـ EVM (مثل مرجعيات PMI/AACE/ISO): بإصدار وسنة، تُراجع ولا تُنسب للنظام كامتثال قبل الاختبار.

## 15) الأمان والخصوصية والتدقيق
- الجدول والتدفق النقدي معلومات تجارية حساسة. تقييد التصدير وختم النسخ.
- تدقيق التعديلات على Baseline والمسار الحرج.
- ملفات XER قد تحمل بيانات؛ مسح قبل الاستيراد.
- AI يقرأ فقط ما يملك المستخدم صلاحية رؤيته.

## 16) الأداء والتوسع
- جداول 50–200k نشاط، علاقات مئات الآلاف، عشرات المشاريع متزامنة.
- CPM تزايدي (تعديل جزئي) خلال ثوانٍ؛ كامل خلال هدف يحدده Owner.
- Gantt بتقسيم العرض (Virtualization). Snapshots مضغوطة.
- هدف: فتح جدول ضخم وتحريره دون تجمد.

## 17) الترحيل والبدء
- استيراد جداول قائمة وBaselines، ومطابقتها مع BOQ.
- مكتبة قوالب منطق وإنتاجيات من مشاريع سابقة (مصنفة UNVERIFIED).
- معالج: «ابدأ من جدول Primavera» أو «من BOQ».

## 18) الاختبارات (Test IDs)
| ID | الاختبار |
|---|---|
| T-PLN-001 | CPM مرجعي (شبكة معروفة): early/late/float/critical path مطابقة بالتفصيل |
| T-PLN-002 | CPM بتقاويم متعددة، علاقات الأربع، Lag/Lead، قيود |
| T-PLN-003 | كشف الدورات والأنشطة الضائعة |
| T-PLN-010 | استيراد/تصدير XER: Round-trip ← لا فقد (مقارنة حقول) |
| T-PLN-011 | استيراد MPP/XML ومطابقة النتائج مع الأداة الأصلية |
| T-PLN-020 | تقدم الكميات ← نسبة النشاط (Physical/Steps/Duration) ← يطابق الحساب اليدوي |
| T-PLN-021 | تقدم >100%/سالب/كمية بلا نشاط ← رفض/تنبيه |
| T-PLN-030 | EVM: PV/EV/AC/CPI/SPI/EAC ببيانات مرجعية ← مطابقة بالأرقام |
| T-PLN-040 | Cashflow: يطابق حسابًا يدويًا لمشروع مبسط (تكلفة+إيراد+محتجز+آجال) |
| T-PLN-050 | Baseline لا يتغير بصمت؛ تغييره يحتاج VO/EOT |
| T-PLN-060 | Delay analysis على حالة مرجعية بنتيجة معروفة |
| T-PLN-070 | Look-ahead: قيود الجاهزية وPPC صحيحان |
| T-PLN-080 | صلاحيات: مهندس موقع لا يعدل Baseline ولا يرى EAC؛ SoD في اعتماد التقدم |
| T-PLN-090 | أداء: 100k نشاط، CPM تزايدي، فتح Gantt |
| T-PLN-091 | عزل مستأجر في الجداول وXER |
| E2E | BOQ ← جدول ← Baseline ← تقدم ← EVM ← مستخلص ← Cashflow |

## 19) معايير القبول وDoD
- **AC-PLN-01:** Given شبكة مرجعية When يُحسب CPM Then كل التواريخ والـ Float والمسار الحرج مطابقة للمرجع في كل الحالات الاختبارية.
- **AC-PLN-02:** Given ملف XER When يُستورد ثم يُصدَّر Then لا تغيير في الأنشطة والعلاقات والتقاويم والموارد، وأي استثناء مسجل.
- **AC-PLN-03:** Given كميات منفذة معتمدة When تُحدَّث Then تتحدث نسب الأنشطة وEV والتنبؤ تلقائيًا بتتبع للمصدر.
- **AC-PLN-04:** Given Baseline معتمد When يُراد تغييره Then يُمنع إلا عبر مسار VO/EOT موثق ونسخة جديدة.
- **AC-PLN-05:** Given نشاط حرج متأخر When يُكتشف Then تنبيه فوري واقتراح إخطار تعاقدي (D04) بدون إرسال تلقائي.
- **AC-PLN-06:** Given Look-ahead When يُغلق الأسبوع Then PPC محسوب بأسباب عدم الإنجاز مصنفة.
- **DoD:** كود + migrations + اختبارات §18 PASS + Evidence Pack + مطابقة مع Primavera على جداول مرجعية + Registers.

## 20) المنافسون (`UNVERIFIED` — فرضيات للتحقق بمصدر وتاريخ)
| المنافس | فرضية | كيف تُقاس |
|---|---|---|
| Oracle Primavera P6/Unifier | المعيار الصناعي في الجدولة والمسار الحرج؛ ضعيف التكامل مع المحاسبة والشراء والموقع دون تكاملات | تنفيذ S1–S4 وقياس إعادة الإدخال |
| MS Project | شائع وبسيط؛ إدارة محافظ ومراحل متقدمة محدودة | S1–S3 |
| Procore / ACC | تقدم ميداني وتنسيق ممتاز؛ جدولة CPM العميقة غالبًا عبر تكامل | S4–S5 |
| Odoo / SAP / Dynamics | مشاريع بسيطة أو عبر Add-ons؛ جدولة إنشائية متخصصة تحتاج أدوات خارجية | S1–S7 |
| Excel + P6 منفصل | الواقع: عزل الجدول عن الكميات والتكلفة | قياس زمن التحديث الشهري |
**فرضية التفوق (H):** جدول مرتبط حيًا بالكميات والتكلفة والتوريد والتقدم يعطي تحديثًا في دقائق بدل أيام، وإنذارًا مبكرًا بالتأخير. **لا نستبدل P6 في أول إصدار**: نتكامل معه ونتفوق في الربط. تُقاس على Golden Flow 4 (Plan-to-Control).

## 21) الفجوات والمخاطر
**فجوات محتملة (تُؤكد بالفحص):** محرك CPM بتقاويم وعلاقات كاملة · XER Round-trip · ربط نشاط-BOQ بأوزان · تقدم فيزيائي من الكميات · EVM وEAC · Cashflow من الجدول · Look-ahead/Make-Ready/PPC · Delay Analysis · Baselines متعددة · 4D · محفظة وموارد مشتركة.
**مخاطر:** (R1) اختلاف نتائج CPM عن P6 فيفقد العميل الثقة ← اختبارات مطابقة على جداول مرجعية. (R2) تقدم مُدخل يدويًا بلا دليل ← ربط بالكميات والصور. (R3) أداء ضعيف في الجداول الضخمة ← قياس مبكر وتزايدي. (R4) تحليل تأخير يُستخدم قانونيًا بلا خبير ← تنبيه ومراجعة متخصص. (R5) نطاق ضخم → التسليم تدريجي.
**قرارات Owner:** هل P6 مصدر الحقيقة أم MISHEL (أو الاثنان بقاعدة) · طريقة المسار الحرج الافتراضية · طرق EVM/EAC الافتراضية · وزن الربط BOQ-نشاط · أولوية 4D · أهداف الأداء.

## 22) تتبع الإنجاز
| البند | الكود | الاختبار | الدليل | الحالة |
|---|---|---|---|---|
| Schedule/WBS/Activities/Relations | UNKNOWN | T-PLN-001–003 | — | UNKNOWN |
| CPM والتقاويم | UNKNOWN | T-PLN-001/002 | — | UNKNOWN |
| Import/Export XER/MPP | UNKNOWN | T-PLN-010/011 | — | UNKNOWN |
| Progress وربط BOQ | UNKNOWN | T-PLN-020/021 | — | UNKNOWN |
| EVM/Forecast | UNKNOWN | T-PLN-030 | — | UNKNOWN |
| Cashflow | UNKNOWN | T-PLN-040 | — | UNKNOWN |
| Baselines/Change Control | UNKNOWN | T-PLN-050 | — | UNKNOWN |
| Delay Analysis | UNKNOWN | T-PLN-060 | — | UNKNOWN |
| Look-ahead/PPC | UNKNOWN | T-PLN-070 | — | UNKNOWN |
| AI (Reviewer/Predictor) | UNKNOWN | T-PLN-070+Evals | — | UNKNOWN |
> تُحدَّث بعد R0 والفحص مقابل الكود، وتُسجَّل في Requirement_Trace.
