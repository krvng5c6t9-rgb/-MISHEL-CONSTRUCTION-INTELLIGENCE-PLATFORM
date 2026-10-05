# D20 — Platform, Integration & AI Operations (المنصة والتكامل وتشغيل الذكاء الاصطناعي)
**Template:** MISHEL_MODULE_DEEP_DIVE_TEMPLATE v1.0 | **Version:** v1.0.0 | **Depth:** D5 (هدف) | **الحالة:** `SPEC DRAFT — لم يُقارَن بالكود بعد` (كل حالة UNKNOWN حتى R0/Forensic)
**ملاحظات:** هذا الموديول «الأرضية التشغيلية» لكل الموديولات: من يوفر المستأجر والبيئات والمراقبة والنسخ الاحتياطي والأسرار وبوابة الـ API ومركز التكامل، ويشغّل طبقة الذكاء الاصطناعي وفق M05 (AI Gateway، السجلات، الـ Evals، التكلفة، Kill Switch) وخدمة إعداد Mishel Brain. n8n وأي محرك أتمتة = طبقة تنسيق غير مرجعية، ومنطق الأعمال المعتمد يبقى في المنتج. أي ادعاء عن قوانين حماية البيانات، إقامة البيانات، شهادات الأمن، أو صيغ الفاتورة الإلكترونية لدولة ما = `PENDING EVIDENCE`. كل رقم (RPO/RTO، حدود المعدل، الحصص، مدد الاحتفاظ، عتبات التكلفة) **مثال يحدده Owner**. يرجى الرجوع إلى M03 (المعمارية) وM04 (الأمن) وM05 (الذكاء الاصطناعي).

## 1) الهوية
- **الاسم:** Platform, Integration & AI Operations · **العائلة:** Platform · **Tier:** T0 (أساسي لكل ما عداه) · **المالك:** Platform Architect + Head of SRE + AI Platform Lead + Security Lead
- **يعتمد على:** D01 (مستأجر/هوية/صلاحيات/DOA)، M03/M04/M05 كمعايير ملزمة.
- **يخدم:** كل D01–D19 (تكاملات، إشعارات، ملفات، ذكاء، إعدادات، مراقبة).
- **IDs:** `REQ-PLT-*`, `WP-PLT-*`.

## 2) الغرض والمستخدمون
**المشكلة:** منصات الـ ERP للمقاولات تُسلَّم بتشغيل يدوي: بيئات غير متطابقة، نسخ احتياطي غير مُختبَر، أسرار في ملفات، تكاملات نقطة-لنقطة هشة، استدعاءات لنماذج ذكاء اصطناعي بلا حوكمة ولا تتبع تكلفة، إعدادات تتغير بلا موافقة ولا نسخ، وعند مغادرة عميل لا توجد طريقة منظمة لتصدير بياناته.
| Persona | أهم المهام |
|---|---|
| Platform Admin (المزوّد) | توفير المستأجرين، الخطط، الإصدارات |
| Tenant Admin (العميل) | المستخدمون، الإعدادات، التكاملات، الحصص |
| SRE / DevOps | CI/CD، المراقبة، الحوادث، DR |
| Security Officer | الأسرار، المفاتيح، السجلات، الاستجابة |
| مهندس تكامل | موصلات، Mapping، مراقبة الطوابير |
| AI Platform Lead | Gateway، السجلات (Registries)، Evals، التكلفة |
| Owner/Product | Brain Config، Feature Flags، الحزم |
| Support Engineer | تشخيص بصلاحية محدودة وموثقة |
| Partner/Developer | امتدادات (Extensions) وAPI |
**مقياس النجاح (Owner):** زمن توفير مستأجر · نسبة النشر الآلي بلا تدخل · MTTR للحوادث · نجاح اختبار الاسترجاع الدوري · نسبة التكاملات بمراقبة وإعادة محاولة · تغطية سجل الذكاء (كل استدعاء مسجل = 100%) · انحراف التكلفة عن الحصة.

## 3) السيناريوهات (Given/When/Then)
**S1 — توفير مستأجر:** Given عقد خطة (Starter/Business/Enterprise كأمثلة) · When يطلب Platform Admin إنشاء مستأجر · Then تُنشأ الهوية والعزل والمفاتيح الخاصة والإعدادات الافتراضية (Country Pack، لغة، عملة) وأدوار البداية، وتُفعَّل الميزات حسب الخطة، ويُسجل كل ذلك في Provisioning Log قابل للإعادة.
**S2 — نشر إصدار:** Given Pull Request معتمد · When يمر خط CI/CD · Then يمر بالاختبارات والفحص الأمني والترحيلات على نسخة، ثم Canary فتدرج، مع Rollback آلي عند تجاوز مؤشرات الخطأ.
**S3 — حادثة وتنبيه:** Given ارتفاع أخطاء API · When يتجاوز SLO · Then تنبيه بالمالك ولوحة، ويربط تتبع (Trace) من الطلب إلى الاستعلام، ويُفتح سجل حادثة وPostmortem.
**S4 — استرجاع من نسخة:** Given فقد بيانات مستأجر · When يُنفَّذ استرجاع نقطة زمنية (PITR) على بيئة معزولة · Then تُتحقق السلامة (ميزان مراجعة، عدّادات) قبل الاعتماد، ويُسجل RPO/RTO الفعلي.
**S5 — موصل تكامل:** Given مورد ERP خارجي (مثال SAP/Odoo) · When يُفعَّل موصل · Then يُعرَّف Mapping واتجاه البيانات، ويعمل بـ Idempotency وإعادة محاولة وDead-letter، وتظهر شاشة تسوية للفروق.
**S6 — استيراد Primavera/IFC:** Given ملف XER أو IFC · When يُرفع · Then Job غير متزامن يعرض معاينة وتقرير أخطاء، ولا يُطبق بدون موافقة المستخدم على الخريطة.
**S7 — أتمتة n8n:** Given Workflow يربط بريدًا بسجل · When يستدعي المنتج · Then يستعمل هوية خدمة بصلاحيات دنيا وWebhook موقعًا، وأي أثر مالي/تعاقدي يمر عبر API المنتج المعتمد لا الجداول.
**S8 — استدعاء ذكاء:** Given Agent يطلب نموذجًا · When يمر بـ AI Gateway · Then تُفحص الصلاحية والحصة والسياسة (تجهيل/إقامة)، وتُسجَّل الرموز والتكلفة والمدخل والسياق والمخرج، ويُوجَّه للنموذج المناسب مع Fallback.
**S9 — Kill Switch:** Given اكتشاف سلوك خطر لـ Agent · When يفعّل المسؤول إيقافًا (مستأجر/Agent/نموذج/نظام) · Then يتوقف خلال ثوانٍ (مثال) وتتراجع الميزة إلى مسار يدوي، وتُسجل الحادثة.
**S10 — تغيير Brain Config:** Given تعديل قاعدة أو Prompt أو حد · When يُقدَّم · Then يمر بمسودة ← اختبار Evals ← اعتماد (Maker-Checker) ← نشر مرحلي بنسخة، مع إمكانية Rollback.
**S11 — Feature Flag وWhite-label:** Given عميل يحتاج هوية بصرية ولغة · When تُطبَّق حزمة Localization/Branding · Then تظهر عبر الواجهة والمخرجات دون تفرع للكود.
**S12 — إنهاء مستأجر (Offboarding):** Given إنهاء عقد · When يُطلب التصدير · Then يُنتج Export كامل موقّع (بيانات + مستندات + سجل تدقيق) ثم فترة سماح ثم حذف مُوثَّق بشهادة، مع احترام الاحتفاظ القانوني `PENDING EVIDENCE`.
**الحالات الحدية:** تجاوز حصة API · موصل يفقد اعتماداته · Webhook مكرر أو متأخر · رسالة سامّة في الطابور · ترقية مخطط بقاعدة ضخمة · تدوير مفتاح أثناء عمل · نموذج يتغير سلوكه بعد تحديث المزود · Prompt Injection من ملف مستورد · مستأجر يستنزف موارد مشتركة (Noisy Neighbor) · تعارض إصدارات امتداد.

## 4) نموذج البيانات
| الكيان | سمات رئيسية | SoT |
|---|---|---|
| Tenant / Plan / Entitlement | tenant, plan, features[], quotas{}, region, status, created_at | Platform |
| Environment / Release | env (dev/stage/prod), version, build, deploy_log, status | Platform |
| ProvisioningJob | tenant, steps[], status, rollback_ref | Platform |
| Secret / KeyRef | scope, name, kms_key_ref, rotated_at, owner (لا قيمة في الجداول) | Secrets Vault |
| ApiClient / ApiKey / RateLimitPolicy | client, scopes, limits, tenant, status, last_used | Platform |
| Connector (Catalog) | type, version, capabilities, auth_mode, status | Integration Hub |
| ConnectorInstance | tenant, connector, credentials_ref, direction, schedule, status | Integration Hub |
| FieldMapping / MappingVersion | instance, source_field, target_field, transform, version | Integration Hub |
| IntegrationRun / DeadLetter | instance, run_id, counts, errors[], payload_ref, retry_count | Integration Hub |
| WebhookSubscription | tenant, event, url, secret_ref, signing_alg, status | Platform |
| AutomationFlow (External) | engine (n8n…), flow_id, owner, service_identity, scopes, status | Integration Hub (سجل فقط) |
| MCPServer / MCPTool | tool, schema, required_permission, risk_class, version, status | Tool Registry |
| ModelRegistry | model_id, provider, version, capabilities, data_policy, cost, status | AI Platform |
| PromptRegistry | prompt_id, version, owner, eval_ref, status | AI Platform |
| ToolRegistry / SkillRegistry / AgentRegistry | id, version, scopes, autonomy_level, owner, evals, status | AI Platform |
| AIRequestLog | tenant, user, agent, model, prompt_ver, context_refs, tools_called, tokens, cost, output_ref, human_decision | AI Platform (Immutable) |
| EvalSuite / EvalRun / GoldenSet | feature, dataset_ver, metrics, thresholds, result, model/prompt versions | AI Platform |
| AIBudget / Quota | tenant, agent, feature, period, limit, spent, alert_at | AI Platform |
| KillSwitch | scope (system/tenant/agent/model/feature), state, reason, set_by | AI Platform |
| BrainConfig / ConfigVersion | namespace, key, value, version, status, approved_by, effective_from | Brain Service |
| FeatureFlag | key, scope, rule, rollout_pct, owner, expiry | Platform |
| LocalizationPack / BrandPack | locale, strings, formats, rtl, logo, theme, version | Platform |
| Extension / ExtensionInstall | id, version, permissions, sandbox_policy, status | Extensions |
| SupportSession | tenant, engineer, reason, scope, approved_by, expires, actions[] | Platform (Audit) |
| BackupJob / RestoreTest | tenant, type, snapshot_ref, result, rpo_actual, rto_actual | Platform |
| TenantExport / DeletionCertificate | tenant, scope, hash, signed_by, date | Platform |
**قواعد:** لا قيم أسرار في قاعدة التطبيق (مرجع للـ Vault فقط) · AIRequestLog غير قابل للتعديل · كل Config بنسخة ولا تعديل بالموقع · كل موصل/Agent/أداة بمالك وإصدار · مفاتيح التشفير لكل مستأجر حسب الخطة · لا بيانات مستأجر في سجلات التشخيص دون إخفاء.

## 5) دورة الحياة والـ Workflow
- **Tenant:** `Requested → Provisioning → Active → Suspended → Offboarding → Exported → Deleted`.
- **Release:** `Built → Tested → Staged → Canary → Rolled-out/Rolled-back`.
- **ConnectorInstance:** `Draft → Configured → Tested → Active → Degraded → Disabled`.
- **Agent/Prompt/Tool/Model:** `Draft → Evaluated → Approved(Shadow) → Assist → (Act: قرار Owner) → Retired`.
- **BrainConfig:** `Draft → Evaluated → Approved → Staged → Active → Superseded`.
- **KillSwitch:** `Off → On(scope) → Reviewed → Off`.
- **SupportSession:** `Requested → Approved(tenant) → Active(time-boxed) → Expired/Closed`.
- **اعتمادات (قابلة للإعداد):** تغيير Brain Config، ترقية استقلالية Agent، تفعيل موصل بأثر مالي، منح جلسة دعم، تدوير مفتاح رئيسي، حذف مستأجر، نشر Release للإنتاج.
- **التراجع:** Rollback للإصدار، لـ Config بنسخة سابقة، لـ Prompt بنسخة، ولا حذف للسجلات.

## 6) الصلاحيات
- **SoD إلزامي:** من يطوّر لا ينشر للإنتاج منفردًا · من يغيّر Brain Config لا يعتمده · من يرقّي استقلالية Agent لا يعتمد Evals · من يملك الأسرار لا يملك الاطلاع على بيانات العميل · من يطلب جلسة دعم لا يوافق عليها.
- أدوار: Platform Admin / Tenant Admin / SRE / Security / Integration Engineer / AI Platform / Support / Partner.
- مدير المستأجر يرى إعدادات مستأجره فقط، لا إعدادات المنصة.
- الدعم: لا وصول افتراضي لبيانات العميل؛ جلسة موافَق عليها محددة المدة والنطاق (Break-glass مع تدقيق).
- هويات الخدمة (n8n، موصلات، Agents) بصلاحيات دنيا ومفاتيح قصيرة العمر.
- «توفر أداة ≠ صلاحية»: كل MCP Tool يفحص صلاحية المستدعي الأصلي خادميًا (M05).

## 7) الأحداث والربط التلقائي
**منتج:** `tenant.provisioned/suspended/offboarded` · `release.deployed/rolled_back` · `incident.opened/resolved` · `backup.completed/failed` · `restore_test.passed/failed` · `secret.rotated` · `rate_limit.exceeded` · `connector.run_completed/failed` · `deadletter.added` · `webhook.delivery_failed` · `ai.request_logged` · `ai.budget_threshold` · `ai.killswitch_changed` · `eval.run_completed` · `config.approved/rolled_back` · `flag.changed` · `export.ready`.
**مستهلك مع الأثر:** أحداث كل الموديولات (D01–D19) ← توجيه إلى Webhooks/موصلات/Automation حسب الاشتراك · `ai.budget_threshold` ← تنبيه ثم تقييد تدريجي · `eval.run_completed` (فشل) ← حجب ترقية Agent/Prompt · `config.approved` ← إبطال التخزين المؤقت وإشعار الموديولات المتأثرة · `connector.run_failed` ← قائمة استثناءات في الموديول المالك (مثال D13 لتكامل البنك) · `tenant.offboarded` ← إيقاف الجدولة ومنع الكتابة.
**موثوقية:** Outbox ونشر مرة-على-الأقل مع Idempotency، توقيع Webhooks (HMAC)، إعادة محاولة بتراجع أسّي، Dead-letter مع إعادة تشغيل يدوية، ترتيب حسب مفتاح التجميع.

## 8) الواجهات البرمجية
`/v1/tenants`, `/plans`, `/environments`, `/releases`, `/api-clients`, `/webhooks`, `/connectors`, `/connector-instances`, `/mappings`, `/integration-runs`, `/dead-letters`, `/mcp/tools`, `/ai/gateway` (الوحيد المسموح للنماذج), `/ai/models`, `/ai/prompts`, `/ai/agents`, `/ai/evals`, `/ai/budgets`, `/ai/killswitch`, `/brain/config`, `/feature-flags`, `/packs/localization`, `/packs/brand`, `/extensions`, `/support-sessions`, `/backups`, `/exports`. بوابة API: مصادقة (OAuth2/OIDC/مفاتيح)، نسخ بالمسار `/v1`، حدود معدل لكل (مستأجر، عميل، مسار) قابلة للإعداد، Idempotency-Key، ETag، ترقيم صفحات، أخطاء موحدة، OpenAPI، سياسة إهمال بمهلة معلنة. MCP Server: تسجيل الأدوات بمخطط وفئة خطورة، لا أدوات كتابة مالية أو تعاقدية مباشرة.

## 9) الواجهة (UX)
- لوحة المستأجر: الخطة، الاستهلاك، الحصص، حالة التكاملات والذكاء.
- مركز التكامل: كتالوج موصلات، معالج Mapping بالسحب، معاينة، سجل تشغيلات، Dead-letter بإعادة تشغيل.
- لوحة المراقبة: SLO، أخطاء، زمن، طوابير، تتبع يربط الطلب بالاستعلام.
- لوحة AI Ops: استدعاءات، تكلفة لكل Agent/ميزة، نتائج Evals، Kill Switch بزر واضح وتأكيد.
- محرر Brain Config بمقارنة نسخ وموافقة ونشر مرحلي.
- شاشة Feature Flags وحزم اللغة/الهوية بمعاينة مباشرة.
- بوابة الدعم: طلب جلسة وموافقة العميل وسجل الإجراءات.
- معالج Offboarding بقائمة تحقق. RTL/LTR، حالات فارغة، وإمكانية وصول.

## 10) القواعد والحسابات
- **حدود المعدل:** Token Bucket لكل (مستأجر، عميل، مسار)؛ تجاوزها = 429 مع Retry-After؛ القيم أمثلة Owner.
- **إعادة المحاولة:** تراجع أسّي مع Jitter وحد أقصى، ثم Dead-letter.
- **تكلفة الذكاء:** تكلفة الطلب = رموز المدخل × سعر + رموز المخرج × سعر (من ModelRegistry بإصدار)؛ الحصة تُحسب لكل مستأجر/Agent/ميزة بفترة؛ عند 80% (مثال) تنبيه، وعند 100% تقييد أو تحويل لنموذج أرخص بحسب السياسة.
- **توجيه النماذج:** حسب المهمة والخصوصية (محلي/سحابي/منطقة) والتكلفة، مع Fallback مسجل.
- **SLO وميزانية الخطأ:** تُحدد لكل خدمة؛ استنفادها يجمد الإصدارات غير الإصلاحية.
- **RPO/RTO:** أهداف لكل خطة (أمثلة)، تُقاس فعليًا في RestoreTest.
- **Brain Config:** الأولوية Tenant > Plan > Global، ولا تغيير بأثر رجعي، والتفعيل مرحلي.
- **تدوير الأسرار:** دوري ويدوي طارئ، مع نافذة قبول المفتاحين.
- **قاعدة ذهبية:** الأرقام المالية/الكميات/التواريخ من الحساب الحتمي لا من الذكاء؛ والمخرجات تتحقق من المخطط وحدود الأرقام (M05).

## 11) المخرجات والتقارير (Output Factory) — «علّم مرة ثم ولّد»
| المخرج | يعتمد على |
|---|---|
| تقرير استهلاك المستأجر والفوترة الداخلية | Tenant/Quota |
| تقرير SLO والحوادث وPostmortem بقالب | Incident/Metrics |
| تقرير تدقيق AI (استدعاءات، قرارات بشرية، تكلفة) | AIRequestLog |
| تقرير Evals لكل ميزة/نسخة | EvalRun |
| تقرير حالة التكاملات والتسويات | IntegrationRun |
| حزمة Evidence للتدقيق الأمني | Audit/Secrets/Backup |
| شهادة استرجاع (Restore Test) | RestoreTest |
| حزمة تصدير المستأجر وشهادة الحذف | TenantExport |
| وثائق API (OpenAPI) وسجل الإهمال | Gateway |
**آلية التعلم من مثال:** يرفع المسؤول نموذج تقرير حوادث أو تدقيق سابق ← يستنتج النظام الأقسام والمؤشرات ← يربط الحقول بمصادر البيانات ← قالب نسخة 1 مع اختبار تطابق ← اعتماد ← توليد لاحق بفحوص قبل الإصدار. الأرقام من المقاييس والسجلات لا من النموذج، والقالب لا يتغير بصمت. كذلك يُتعلَّم Mapping التكامل من ملف مثال (Excel/XER/CSV) بالمعاينة والاعتماد.

## 12) التكاملات
**كتالوج الموصلات (مستهدف؛ كل موصل بنسخة وحالة وتوثيق):**
| الموصل | الاتجاه والغرض |
|---|---|
| Primavera P6 / MS Project | استيراد/تصدير XER/XML للجداول والموارد مع D05 |
| Revit / AutoCAD / IFC | كميات ونماذج وربط عناصر مع D16/D03 (عبر ملفات أو واجهات موثقة) |
| SAP / Odoo / Oracle / Dynamics | مزامنة حسابات، موردين، ميزانية، قيود مع D13/D06 |
| Excel / CSV | استيراد ذكي وتصدير بمعاينة وتقرير أخطاء |
| البريد (SMTP/IMAP/Graph) | إرسال إشعارات، التقاط مراسلات وربطها بسجل D15 |
| البنوك | استيراد كشوف وملفات دفع وحالة التنفيذ، حسب توثيق كل بنك فقط |
| الفاتورة الإلكترونية والضرائب | خطاف (Hook) عبر Country Pack وخدمات رسمية `PENDING EVIDENCE` لكل جهة |
| SSO/IdP (OIDC/SAML) و SCIM | هوية ومستخدمون |
| التقويم/التخزين/المراسلة | حسب التوثيق والترخيص |
- **n8n/الأتمتة:** طبقة تنسيق غير مرجعية؛ لا منطق أعمال معتمد فيها؛ هوية خدمة، Idempotency، توقيع Webhooks، سجل Workflows بمالك وإصدار، ومنع الكتابة المباشرة على الجداول.
- **MCP Server:** يعرض أدوات قراءة/اقتراح بمخطط، وأدوات الأثر تتطلب تأكيدًا بشريًا؛ تسجيل كل استدعاء.
- **سياسات عامة:** لا سحب آلي من مواقع بلا ترخيص؛ لكل تكامل Mapping وإعادة محاولة وتسوية وسجل أخطاء وحصة.

## 13) الذكاء الاصطناعي (تشغيل المنصة)
هذا القسم يطبّق M05 تشغيليًا ويحكم ذكاء كل الموديولات.
- **AI Gateway:** نقطة واحدة؛ مصادقة، صلاحيات، تسجيل كامل، حصص، فلترة، تجهيل، توجيه نماذج، Fallback. ممنوع أي استدعاء نموذج خارجها.
- **Registries:** Models/Prompts/Tools/Skills/Agents بنسخ ومالك وحالة؛ ربط كل Agent بقائمة أدوات وصلاحيات وحدود ومجموعة Evals.
- **Evals Pipeline:** Golden Sets مجهَّلة لكل ميزة من الموديولات؛ تشغيل تلقائي عند تغيير نموذج/Prompt/بيانات (Regression)، وRed-team دوري (Injection، تسريب)، ونتيجة تحجب الترقية عند الفشل؛ حدود القبول من Owner.
- **Autonomy:** Shadow ثم Assist فقط؛ **Act** لا يُمنح لأي أثر مالي/تعاقدي/سلامة، وأي ترقية بقرار Owner ونتائج Evals.
- **التكلفة:** لوحة لكل مستأجر/Agent/ميزة، حصص، تنبيهات، وتقييد تدريجي.
- **Kill Switch:** مستويات (نظام/مستأجر/Agent/نموذج/ميزة)، سريان خلال ثوانٍ (مثال)، مجرَّب دوريًا (Game Day).
- **الحماية:** المحتوى الوارد (ملفات، بريد، ويب) = بيانات لا أوامر؛ عزل التعليمات؛ التحقق من المخطط؛ إخفاء بيانات حساسة قبل النماذج الخارجية؛ عدم التدريب على بيانات العميل ما لم يُتفق؛ إقامة البيانات `PENDING EVIDENCE`.
- **Mishel Brain Config:** خدمة إعداد بنسخ (قواعد، أعتبة، Prompts، سياسات التوجيه)، مسودة ← Evals ← اعتماد ← نشر مرحلي ← Rollback، وكل نسخة قابلة للمقارنة والتدقيق، ولا تغيير صامت.
- **Anomaly/Ops Assistant:** يقترح تشخيص الحوادث وتجميع التنبيهات وتلخيص Postmortem بالأدلة؛ لا ينفذ إجراءات تشغيلية (نشر، حذف، تغيير أسرار) بنفسه.
- **Mapping Assistant:** يقترح خرائط حقول للتكامل بنسبة ثقة؛ القبول بشري.
- **Evals لهذه الميزات:** دقة اقتراح الخرائط، جودة تجميع الحوادث، معدل الإنذار الكاذب.

## 14) العالمية والامتثال (`PENDING EVIDENCE`)
- قوانين حماية البيانات وإقامة البيانات ونقلها عبر الحدود لكل ولاية، ومزودي الاستضافة والنماذج المسموحين.
- شهادات أمنية (مثل ISO 27001 / SOC 2 كأمثلة) — لا تُدّعى قبل التدقيق والإصدار.
- متطلبات الفاتورة الإلكترونية والتكامل الحكومي لكل بلد عبر Country Pack وخدمات رسمية فقط.
- متطلبات احتفاظ السجلات والنسخ الاحتياطي والحذف.
- حزم Localization: لغات، RTL، تقويم هجري/ميلادي، أرقام عربية/غربية، تنسيقات عملة وتاريخ، ومصطلحات قطاعية.
- White-label: ضوابط استخدام العلامات التجارية والترخيص.
- قيود تصدير التقنية أو التشفير إن وُجدت `PENDING EVIDENCE`.
- لا يقدم المنتج رأيًا قانونيًا؛ يوفر ضوابط وأدلة.

## 15) الأمان والخصوصية والتدقيق
- **Threat model:** سرقة مفتاح API أو سر موصل · هجوم Injection عبر ملف/بريد · تسرب بين المستأجرين · Noisy Neighbor · سلسلة توريد (مكتبات/امتدادات) · إساءة استخدام جلسة الدعم · تضخم تكلفة ذكاء متعمد · تلاعب بـ Brain Config.
- **الأسرار والمفاتيح:** Vault/KMS، لا أسرار في الكود أو السجلات، تدوير، مفاتيح لكل مستأجر (حسب الخطة)، تشفير أثناء النقل والتخزين، BYOK خيار مستقبلي.
- **عزل المستأجرين:** صفوف/مخططات/قواعد حسب الخطة، وحصص موارد، واختبار تسرب آلي.
- **سلسلة التوريد:** SBOM، فحص الاعتماديات، توقيع الصور، فحص الامتدادات قبل الإتاحة وSandbox بصلاحيات محددة.
- **النسخ الاحتياطي:** تشفير، عزل جغرافي، ونسخ غير قابلة للتعديل (Immutable)، واختبار استرجاع دوري.
- **الدعم:** جلسات بموافقة العميل ومحددة المدة، وتسجيل كل إجراء، وإخفاء الحقول الحساسة.
- **Audit:** كل تغيير إعداد/موصل/Agent/Config/مفتاح بمن وقبل/بعد؛ سجلات AI غير قابلة للتعديل.
- مواءمة مع M04 وM05.

## 16) الأداء والتوسع
- أحجام مستهدفة (Owner يؤكد): مئات المستأجرين، آلاف المستخدمين المتزامنين، ملايين أحداث/يوم، طوابير تكامل بمئات الآلاف رسالة.
- توسع أفقي للخدمات عديمة الحالة، وفصل أحمال (API، Jobs، تكاملات، ذكاء) في مجموعات موارد منفصلة.
- Backpressure وحدود طوابير وأولويات، وSLOs لكل مستوى خدمة.
- تخزين مؤقت للإعداد (Brain Config) بإبطال بالأحداث.
- ذاكرة مؤقتة دلالية لاستدعاءات الذكاء حيث تسمح السياسة، ومعالجة دفعية للمهام غير العاجلة.
- أهداف p95 (زمن API، زمن Gateway، زمن Job، زمن النشر) وRPO/RTO يحددها Owner قبل القياس.

## 17) الترحيل والبدء
- Infrastructure as Code لكل البيئات، مع Drift Detection.
- ترحيل المخطط بخطوات متوافقة للخلف (Expand/Contract)، واختبار على نسخة من بيانات واقعية.
- معالج الإعداد الأولي للمستأجر: بلد (Country Pack)، لغة، عملة، SSO، حزمة موصلات مقترحة.
- استيراد إعدادات من نظام قائم، وفهرس موصلات حالية مع تقييم أولويات.
- تفعيل الذكاء تدريجيًا: Shadow لكل ميزة بعد اجتياز Evals، ولا شيء مفعّل افتراضيًا بلا اعتماد Owner.
- تمرين Game Day: استرجاع، Kill Switch، تدوير مفتاح قبل الإنتاج.

## 18) الاختبارات (Test IDs)
| ID | الاختبار |
|---|---|
| T-PLT-001 | توفير مستأجر آليًا: الهوية والعزل والإعدادات ← سليم، وإعادة التشغيل Idempotent |
| T-PLT-002 | الخطة والـ Entitlements: ميزة خارج الخطة ترفض |
| T-PLT-010 | CI/CD: اختبارات + فحص أمني + Canary + Rollback آلي عند خطأ مزروع |
| T-PLT-011 | ترحيل مخطط Expand/Contract بلا توقف على بيانات حجم واقعي |
| T-PLT-020 | مراقبة: حدث مزروع ← تنبيه + Trace كامل من الطلب للاستعلام |
| T-PLT-030 | استرجاع PITR على بيئة معزولة ← سلامة الأرصدة وRPO/RTO ضمن الهدف |
| T-PLT-031 | النسخ الاحتياطي غير قابل للتعديل وتشفيره سليم |
| T-PLT-040 | الأسرار: لا قيمة في الكود/السجلات (فحص آلي)، وتدوير بلا انقطاع |
| T-PLT-050 | Gateway: حد معدل، 429 مع Retry-After، وعزل بين المستأجرين |
| T-PLT-051 | Idempotency وETag وترقيم صفحات وأخطاء موحدة، والإهمال بإشعار |
| T-PLT-060 | موصل بنك/ERP: إعادة محاولة، Dead-letter، تسوية بلا فقد أو تكرار |
| T-PLT-061 | استيراد XER وIFC وExcel بمعاينة وتقرير أخطاء، وعدم التطبيق بلا موافقة |
| T-PLT-062 | Webhook موقّع: تزوير يرفض، تكرار لا يكرر الأثر |
| T-PLT-070 | n8n: لا كتابة مباشرة على الجداول، ويعمل بصلاحيات دنيا |
| T-PLT-071 | MCP: فحص صلاحية خادمي للمستدعي، وعدم وجود أدوات ترحيل/دفع/اعتماد |
| T-PLT-080 | AI Gateway: كل استدعاء مسجل (تغطية 100%) ولا مسار يتخطاه |
| T-PLT-081 | الحصص والتكلفة: تنبيه 80% وتقييد عند 100% (أمثلة) |
| T-PLT-082 | Kill Switch: إيقاف لكل مستوى ضمن الزمن الهدف وتراجع لمسار يدوي |
| T-PLT-083 | Injection وتسريب: ملفات/رسائل خبيثة لا تنفذ أوامر ولا تسرب بيانات |
| T-PLT-084 | Evals Regression: تغيير Prompt/نموذج ينفذ الحزمة، والفشل يحجب الترقية |
| T-PLT-090 | Brain Config: مسودة ← Evals ← اعتماد ← نشر مرحلي ← Rollback، وSoD |
| T-PLT-091 | Feature Flags وحزم Localization/Brand بلا تفرع كود |
| T-PLT-092 | امتداد: Sandbox وحدود الصلاحيات وعدم الوصول عبر المستأجرين |
| T-PLT-100 | دعم: جلسة بموافقة ومحددة المدة، وكل إجراء مسجل |
| T-PLT-101 | Offboarding: تصدير كامل موقّع مطابق، حذف بعد السماح، شهادة |
| T-PLT-110 | حمل: Noisy Neighbor لا يؤثر على مستأجرين آخرين ضمن الهدف |
| E2E | مستأجر جديد ← موصل ERP ← حدث من D06 ← مزامنة D13 ← Agent Shadow ← Evals ← ترقية Assist ← Kill Switch ← Offboarding |

## 19) معايير القبول وDoD
- **AC-PLT-01:** Given طلب مستأجر When يُوفَّر Then بلا تدخل يدوي ومع عزل بيانات ومفاتيح، وإعادة التشغيل لا تنتج تكرارًا.
- **AC-PLT-02:** Given أي استدعاء نموذج When يحدث Then يمر بـ AI Gateway ويُسجَّل بالكامل (مدخل، سياق، أدوات، مخرج، قرار بشري) ويحترم الحصة والسياسة.
- **AC-PLT-03:** Given Agent أو Prompt أو نموذج جديد When يُرقّى Then بعد اجتياز Evals بحدود Owner وقرار موثق، ولا يُمنح Act لأي أثر مالي/تعاقدي.
- **AC-PLT-04:** Given حادثة خطرة When يُفعَّل Kill Switch Then يتوقف النطاق المحدد خلال الزمن الهدف مع تراجع يدوي وسجل.
- **AC-PLT-05:** Given نسخة احتياطية When يُجرى اختبار استرجاع Then RPO/RTO الفعليان ضمن أهداف Owner والسلامة مثبتة، ويصدر Evidence.
- **AC-PLT-06:** Given سر أو مفتاح When يُستخدم Then لا يظهر في الكود/السجلات/قاعدة التطبيق، ويدور دون انقطاع.
- **AC-PLT-07:** Given تكامل خارجي When يفشل Then تظهر الأخطاء في Dead-letter/استثناءات، وإعادة المحاولة آمنة، ولا فقد أو تكرار أثر.
- **AC-PLT-08:** Given Workflow في n8n أو MCP Tool When ينفذ إجراءً ذا أثر Then عبر واجهة المنتج بصلاحية المستخدم الأصلي، لا مباشرة على الجداول.
- **AC-PLT-09:** Given تغيير Brain Config When يُنشر Then بنسخة ومراجعة وSoD وإمكانية Rollback وبلا تغيير بأثر رجعي.
- **AC-PLT-10:** Given إنهاء مستأجر When يكتمل Then تصدير موقّع كامل وحذف موثق بشهادة مع احترام الاحتفاظ القانوني `PENDING EVIDENCE`.
- **DoD:** كود + IaC + اختبارات §18 PASS + Game Day (استرجاع، Kill Switch، تدوير) + Golden Sets/Evals ضمن الحدود + مراجعة أمنية + Evidence Pack + Registers. لا إتاحة ميزة ذكاء لعميل قبل اجتياز Evals.

## 20) المنافسون (`UNVERIFIED` — فرضيات للتحقق بمصدر وتاريخ)
| المنافس | فرضية | كيف تُقاس |
|---|---|---|
| SAP BTP / Oracle Integration | تكامل مؤسسي عميق وتكلفة وتعقيد أعلى؛ جاهزية قطاع الإنشاء تُتحقق | S5/S6 وعدّ الخطوات |
| MuleSoft / Boomi / Azure Integration | منصات تكامل عامة قوية؛ لا تعرف نموذج بيانات المقاولات والـ Mapping الجاهز | زمن تفعيل موصل Primavera/ERP |
| n8n / Zapier / Make | سرعة وكتالوج واسع؛ حوكمة وصلاحيات وSoD للأثر المالي تُتحقق | S7 وفحص الأثر المباشر |
| Procore App Marketplace / Autodesk Platform | منظومة امتدادات في سوقها؛ ملاءمة المحلي والعربي تُتحقق | قياس التغطية |
| منصات LLMOps (Langfuse/LangSmith… أمثلة) | تتبع وتقييم ممتازان؛ منفصلان عن صلاحيات الـ ERP وKill Switch على مستوى المستأجر | S8/S9 |
| Odoo / Dynamics 365 | منصة موحدة وتخصيص؛ حوكمة ذكاء وسجل غير قابل للتعديل تُتحقق | S8–S10 |
**فرضية التفوق (H):** منصة واحدة تجمع تكاملات المقاولات الجاهزة (Primavera/IFC/ERP/بنوك) مع AI Gateway وKill Switch وEvals وBrain Config بنسخ وSoD، مع تصدير مستأجر موثق، تخفض زمن تفعيل التكامل وتمنع الأثر غير المصرح به، وتجعل الذكاء قابلًا للتدقيق. تُقاس على S5/S8/S9/S10.

## 21) الفجوات والمخاطر
**فجوات محتملة (تُؤكد بالفحص):** AI Gateway كنقطة وحيدة · Registries بنسخ · Evals Pipeline وRegression · Kill Switch بمستويات · تتبع تكلفة · Brain Config بنسخ واعتماد · كتالوج موصلات بمراقبة وDead-letter · سجل Workflows الخارجية · MCP Registry · اختبار استرجاع دوري · أسرار/تدوير · جلسات دعم · تصدير وحذف مستأجر موقّعان · Noisy Neighbor · حزم Localization/Brand · نموذج امتدادات بـ Sandbox.
**مخاطر:** (R1) تجاوز الـ Gateway باستدعاء مباشر ← منع شبكي وفحص تغطية السجل. (R2) تغيّر سلوك النموذج عند المزود ← تثبيت إصدار وRegression. (R3) تكلفة ذكاء خارجة عن السيطرة ← حصص وتقييد. (R4) أتمتة خارجية تتجاوز المنتج ← هوية دنيا ومنع كتابة مباشرة. (R5) نسخ احتياطي غير صالح ← اختبار استرجاع دوري. (R6) تكامل هش يفقد أحداثًا ← Outbox وتسوية. (R7) امتداد خبيث ← مراجعة وSandbox. (R8) تعقيد إعدادات Brain يربك ← قوالب ومعالج. (R9) تأخر الإدخال في الامتثال المحلي ← Country Pack قابل للإضافة.
**قرارات Owner:** مزودو الاستضافة والنماذج المسموحون وإقامة البيانات · أهداف RPO/RTO وSLO لكل خطة · الخطط والحصص · حدود معدل API · حدود تكلفة الذكاء وسياسة التقييد · حدود قبول Evals · من يرقّي استقلالية Agent · قائمة الموصلات ذات الأولوية · هل تُتاح الامتدادات لأطراف ثالثة · مدة الاحتفاظ وفترة السماح للحذف · سياسة جلسات الدعم.

## 22) تتبع الإنجاز
| البند | الكود | الاختبار | الدليل | الحالة |
|---|---|---|---|---|
| توفير المستأجرين والخطط | UNKNOWN | T-PLT-001/002 | — | UNKNOWN |
| البيئات وCI/CD والترحيل | UNKNOWN | T-PLT-010/011 | — | UNKNOWN |
| المراقبة والتنبيه | UNKNOWN | T-PLT-020 | — | UNKNOWN |
| النسخ الاحتياطي وDR | UNKNOWN | T-PLT-030/031 | — | UNKNOWN |
| الأسرار والمفاتيح | UNKNOWN | T-PLT-040 | — | UNKNOWN |
| بوابة API وحدود المعدل | UNKNOWN | T-PLT-050/051 | — | UNKNOWN |
| مركز التكامل والموصلات | UNKNOWN | T-PLT-060–062 | — | UNKNOWN |
| n8n وMCP | UNKNOWN | T-PLT-070/071 | — | UNKNOWN |
| AI Gateway والسجلات والتكلفة | UNKNOWN | T-PLT-080/081 | — | UNKNOWN |
| Kill Switch وEvals والحماية | UNKNOWN | T-PLT-082–084 | — | UNKNOWN |
| Brain Config وFlags وLocalization | UNKNOWN | T-PLT-090/091 | — | UNKNOWN |
| الامتدادات والدعم | UNKNOWN | T-PLT-092/100 | — | UNKNOWN |
| Offboarding والتصدير | UNKNOWN | T-PLT-101 | — | UNKNOWN |
| الأداء والعزل | UNKNOWN | T-PLT-110 | — | UNKNOWN |
> تُحدَّث بعد R0 والفحص مقابل الكود، وتُسجَّل في Requirement_Trace.
