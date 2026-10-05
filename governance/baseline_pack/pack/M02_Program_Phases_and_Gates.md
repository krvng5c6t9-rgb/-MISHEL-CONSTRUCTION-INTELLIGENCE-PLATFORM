# M02 — Program Phases & Gates (مراحل البرنامج وبواباته)
**Version:** v1.0.0 | يترجم الـ 14 خطوة (Master §21) وA1 إلى مراحل قابلة للتنفيذ والقبول.
**قاعدة عامة:** كل مرحلة: مدخلات ← خطوات ← مخرجات ← قبول ← إيقاف. تنتهي بـ Gate Report (M09 §4) وقرار Owner.

## P0 — Runtime Truth (R0)
**الهدف:** معرفة هل الكود الحالي يعمل. **مدخلات:** ريبو MISHEL v0.2.
**خطوات:** تثبيت نظيف بـ lockfile · Postgres فاضي + migrations 001→034 · Build باك وفرونت · E2E الأساسي (Lead/Tender→…→Payment) · اختبارات سلبية أولية (عزل، اعتماد ذاتي، تكرار).
**مخرجات:** R0 Report: ما يعمل/لا يعمل/أول 10 Blockers + Logs + hashes.
**قبول:** كل فحص PASS/FAIL بدليل E1. **إيقاف:** تعذر التشغيل (UNVERIFIED) أو Critical.

## P1 — Source Integrity
استرجاع/إعادة بناء Atlas الـ 4,965 صف بـ Controlled Reconstruction. تفسير الفروق (531 مقابل 1,660، 787 مقابل 833). تحديد المرجع الرسمي لكل رقم وحالة الخطط v1–v5.
**قبول:** كل قدرة لها صف، أو فجوة معلنة بسبب. لا ادعاء 4,965/4,965 قبل ذلك.

## P2 — Forensic Traceability
كل Requirement ← كود/DB/API/UI/Workflow/Permission/Agent/Integration/Test/Evidence. تحويل CANDIDATE إلى VERIFIED أو GAP.
**قبول:** 100% من الـ 4,602 لها حالة بدليل. **مخرج:** Requirement_Trace وCode_Evidence_Register.

## P3 — Benchmark
مقارنة على مستوى القدرة مع المنافسين (M06). **قبول:** كل خلية بمصدر وتاريخ أو UNVERIFIED.

## P4 — Scope Freeze & Tiers
تصنيف كل قدرة: KEEP/COMPLETE/REPLACE/BUILD/CONFIGURE/INTEGRATE/SPECIALIST ENGINE/AI-AUGMENT/DEFER/N/A، وتوزيعها على T0–T4 (A1). قرارات Owner D1–D9.
**قبول:** Owner اعتمد الـ Tiers والقرارات. Baseline `FROZEN`.

## P5 — Final Atomic Implementation Plan
Work Packages وPrompt Slices (M08) مبنية على الفجوات الموثقة فقط. ترتيب وتبعيات وتقدير موارد (ESTIMATE).
**قبول:** كل Slice له Acceptance وStop condition ومدخلات مثبتة.

## P6 — Platform Foundation (T0)
Identity/Tenant/RBAC/ABAC/DOA/SoD/Audit/Workflow/Rules/Events/Jobs/Notifications/Configuration/MDM/Observability.
**قبول:** اختبارات عزل وصلاحيات سلبية PASS؛ Audit كامل؛ Event Catalog.

## P7 — Commercial Core (T1)
Tendering/Estimation/BOQ · Procurement · Contracts/IPC · Cost/Finance · Dashboards أساسية · Output Factory الأول.
**قبول:** Golden Flows 1–3 (M06) تعمل E2E بسلامة مالية (توازن، تكرار، Period lock، Reversal).

## P8 — Delivery & Engineering (T2)
Planning/Controls · Technical Office · QA/QC · HSE · Site · HR · CDE.
**قبول:** Golden Flows 4–6 + اختبارات المجال.

## P9 — AI & Automation (T3)
AI Gateway · Registries · Agent Factory · RAG · MCP/n8n · Evals.
**قبول:** M05 كامل، Evals على Golden Datasets، Shadow→Assist→Act مفعّل لكل Agent.

## P10 — Commercial SaaS
Tenancy تجاري · Subscriptions/Licensing/Entitlements/Metering/Billing · Provisioning · Migration Wizard · White-label · Country Packs.
**قبول:** اختبار دورة عميل كاملة (تسجيل، إعداد، استخدام، فوترة، تصدير، إنهاء).

## P11 — Runtime Certification
أمان، عزل، سلامة مالية، تزامن، أداء/حمل، نسخ احتياطي/استعادة، DR، ترقية/تراجع (M07).
**قبول:** Open Blocker/Critical = 0؛ دليل E1 لكل بند.

## P12 — UX & Product QA
RTL/LTR · Responsive/Mobile · Accessibility · سرعة · قياس البساطة (A-plan §8.1) على مستخدمين حقيقيين.

## P13 — Pilot/UAT
حسب M10: عميل حقيقي، بيانات واقعية (مُجهَّلة أو بتصريح)، أدوار فعلية، مقاييس قبل/بعد.

## P14 — Commercial Release
نشر الإنتاج، مراقبة، دعم، وثائق، تأهيل، تسعير/ترخيص، إدارة الحوادث والإصدارات (M10).

## P15 — Competitive Proof
إعادة Benchmark على النسخة العاملة بنتائج Golden Flows. لا ادعاء تفوق بغير قياس.

## قواعد الانتقال
- **P0 قبل أي بناء.** P1–P4 قد تتوازى جزئيًا بعد P0، لكن P5 لا تبدأ قبل P4.
- لا يبدأ Tier قبل تحقق قبول سابقه، ما لم يقرر Owner خلاف ذلك بـ Controlled Change.
- كل مرحلة تُسجَّل في Approval_Register بتاريخها وقرار Owner.
