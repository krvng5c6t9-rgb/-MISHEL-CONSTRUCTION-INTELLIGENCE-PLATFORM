# MISHEL — ADDENDUM A1 to MASTER PROJECT DEFINITION (2026-10-03)
**Status:** PROPOSED — OWNER APPROVAL PENDING | **Type:** Controlled Change Proposal (لا يعدّل أي نص Frozen في الملف الأصلي)
**Change ID:** CC-A1-PENDING | **يقرأ بعد:** MISHEL_PROJECT_MASTER_DEFINITION_STATUS_AND_ROAD_TO_CLOSURE

## 0) تعليمات للـ AI المنفذ
1. اقرأ الملف الأصلي أولًا ثم هذا الملحق. عند التعارض: تعليمات Owner الحالية ثم الملف الأصلي ثم الملحق.
2. كل بند فيه `PENDING OWNER DECISION` ممنوع تفترضه. اجمع كل القرارات المعلقة وقدمها للـ Owner **دفعة واحدة** في Decision Sheet، ولا تسأل عنها متفرقة.
3. كل `PENDING EVIDENCE` يتحول لمهمة بحث من مصدر رسمي، ولا يُكتب فيه رقم أو مادة قانونية من الذاكرة.
4. لا Production Ready ولا FINAL ولا تفوق على منافس بدون دليل (كما في الأصل).
5. لا يبدأ بناء feature جديد قبل إغلاق R0 (البند 1) وتسجيل نتيجته.

## 1) R0 — Runtime Truth Check (يسبق أي تخطيط جديد)
**الغرض:** معرفة هل الكود الحالي يعمل فعلًا، لأن كل التخطيط التالي يعتمد عليه.
| # | الفحص | المخرج المطلوب |
|---|---|---|
| R0-1 | `npm ci` نظيف مع lockfile | Log + نتيجة PASS/FAIL |
| R0-2 | PostgreSQL فاضي ← تنفيذ migrations 001→034 من صفر | Log + أي migration فشل |
| R0-3 | Build كامل للباك إند والفرونت | Log + hash للـ artifacts |
| R0-4 | E2E الأساسي: Lead/Tender ← Project ← BOQ ← PR ← RFQ ← PO ← GRN ← Invoice ← Cost ← GL ← IPC ← Payment | PASS/FAIL لكل حلقة + أول نقطة كسر |
| R0-5 | اختبار سلبي أولي: عزل tenant، self-approval، تكرار | PASS/FAIL |
**تقرير واحد (صفحة) = "ما يعمل / ما لا يعمل / أول 10 blockers".** لو تعذر التنفيذ في بيئة ChatGPT (شبكة أو أدوات)، يُسجَّل `UNVERIFIED` ويُطلب تنفيذه خارجيًا ولا يُقدَّر.

## 2) Scope Tiers (مقترح — لا حذف من الـ Specification، فقط ترتيب تنفيذ)
| Tier | المحتوى | القاعدة |
|---|---|---|
| **T0 Foundation** | Identity/Tenant/RBAC/ABAC/DOA/SoD/Audit/Workflow/Rules/Events/Jobs/Config | لازم قبل أي domain |
| **T1 Commercial Core** | سلسلة E2E أعلاه + Tendering/Estimation/BOQ + Contracts/IPC + Cost/Finance + Dashboards أساسية | أول منتج قابل للتجربة |
| **T2 Delivery & Engineering** | Planning/Controls، Technical Office، QA/QC، HSE، Site، HR، CDE | بعد نجاح T1 على Pilot |
| **T3 AI & Automation** | Agents/RAG/n8n/MCP/Evals فوق بيانات T1/T2 المثبتة | تضاف تدريجيًا Shadow→Assist→Act |
| **T4 Extended (DEFER candidates)** | IoT/OT، ITSM/CMDB، EAM/CAFM، Marketplace، Offsite Manufacturing، Sustainability، Real-Estate Developer، Enterprise Architecture… | تؤجل بقرار Owner، وتبقى في الـ Specification |
**القرار:** `PENDING OWNER DECISION` (اعتماد التقسيم أو تعديله).
ملحوظة: الـ 31 عائلة بلا دليل تُصنف على Tiers بدل ما تظل بنفس الأولوية.

## 3) Owner Decision Sheet (يملأه الـ Owner، ويمنع التنفيذ لحين الإجابة)
| # | القرار | القيمة |
|---|---|---|
| D1 | العميل الأول (Pilot): نوع الشركة وحجمها وعدد المستخدمين | PENDING OWNER DECISION |
| D2 | نموذج النشر: SaaS / Private Cloud / On-Premise / Hybrid | PENDING OWNER DECISION |
| D3 | الأسواق المستهدفة أولًا (مصر / الخليج / دولي) | PENDING OWNER DECISION |
| D4 | الفريق والموارد (عدد المطورين والأدوار) والميزانية | PENDING OWNER DECISION |
| D5 | أسلوب التنفيذ: مطور فريق / تعاقد خارجي / AI-assisted coding بنسبة | PENDING OWNER DECISION |
| D6 | نموذج التسعير والترخيص (Subscription / Per-user / Per-project / Modules) | PENDING OWNER DECISION |
| D7 | Build vs Integrate لكل Engine (Primavera, Revit/BIM, SAP, Odoo, n8n) | PENDING OWNER DECISION |
| D8 | اللغات والواجهات المطلوبة في الإصدار الأول | PENDING OWNER DECISION |
| D9 | هدف زمني للـ Pilot (تاريخ) | PENDING OWNER DECISION |
**الـ AI يقدم لكل قرار: 2–3 خيارات + Trade-offs + توصية، ولا يقرر.**

## 4) Local Compliance Pack (مصر والخليج) — كله PENDING EVIDENCE
بحث من مصادر رسمية فقط، وتسجيل Source + Edition + Date + Applicability:
- الفاتورة والإيصال الإلكتروني والتكامل مع مصلحة الضرائب.
- ضريبة القيمة المضافة وضريبة الخصم والإضافة وضريبة الدمغة وما يخص المقاولات.
- التأمينات الاجتماعية وقانون العمل وعقود العمالة.
- حماية البيانات الشخصية واستضافة البيانات وعبور الحدود.
- التعاقدات العامة والمناقصات الحكومية (لو العميل يتعامل مع جهات حكومية).
- أكواد ومعايير البناء المحلية المرتبطة بالـ Rules Engines.
- متطلبات الخليج المقابلة لو الهدف يشمل أسواقه.
**المخرج:** Compliance Register (Requirement ← Source ← Applies to which module ← Status).

## 5) AI Acceptance Gates (قبل أي ميزة AI تُسلَّم لعميل)
| ميزة | شرط القبول |
|---|---|
| قراءة الرسومات واستخراج الكميات | اختبار على عينة تندرات/رسومات سابقة بنتائجها الحقيقية؛ نسبة الدقة المقبولة يحددها Owner؛ مراجعة بشرية إجبارية |
| مطابقة BOQ والتوصيف | مقارنة بمقايسات معتمدة؛ تسجيل الأخطاء بالنوع |
| التسعير وتحليل الأسعار | مصدر السعر + تاريخه ظاهر؛ لا سعر مختلق؛ حدود تسامح يحددها Owner |
| أي Agent يتخذ إجراء | Shadow ثم Assist ثم Act، مع Kill Switch وAudit |
Golden Dataset لكل ميزة، تتسجل نتائجها في Evals Register.

## 6) Delivery & Adoption (غير مذكور في الأصل)
خطة تطبيق عند العميل: Implementation methodology · Data migration rehearsal · تدريب الأدوار · Documentation · Support/SLA · Customer Success · Implementation Partners · Change management. كلها `PENDING OWNER DECISION` في الشكل والمسؤول.

## 7) تحقق من الاتساق (يُنفَّذ قبل اعتماد الملحق)
- الفرق بين عدد المتطلبات بلا دليل في الفحوصات المختلفة (مثلًا 531 مقابل 1,660): يحدد AI أي فحص هو المرجع ولماذا، ويسجل ذلك في Decision Register.
- الفرق بين مجموع Work Packages في الموجات (833) والعدد المعلن (787): يفسَّر (تقسيم WP على أكثر من موجة؟) أو يصحح.
- حالة خطط v1→v5: يسجل رسميًا أيها Superseded وأيها مرجع.

## 8) مخرجات متوقعة من الـ AI بعد قراءة الملحق (بالترتيب)
1. R0 Report. 2. جدول الاتساق (البند 7). 3. Decision Sheet معبأ بالخيارات والتوصيات. 4. Compliance Register (هيكل فاضي + مصادر مرشحة). 5. Tier Proposal مفصل بعدد المتطلبات في كل Tier. 6. Gate Report واحد ينتظر قرار Owner.
