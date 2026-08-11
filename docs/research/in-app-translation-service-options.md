# In-app translation service options

**Research question:** Which services and integration patterns can generate draft English, Spanish, Portuguese, French, and Haitian Creole translations inside the editor for interface strings, Learning Module content, intake questions, and answer options, without translating student answers?

**Research date:** 2026-08-11

## Executive answer

Google Cloud Translation, Azure Translator, Amazon Translate, and DeepL API all currently document text translation for the five required languages, including Haitian Creole (`ht`) [G1] [A1] [W1] [D1]. Haitian Creole is therefore no longer a reason to eliminate DeepL. Oracle Translate and NAVER Cloud Papago do not list Haitian Creole and should be eliminated by the hard language filter; Papago also omits Portuguese [O1] [N1].

For the later provider decision, take **Google Cloud Translation, Azure Translator, and paid DeepL API** into a controlled, human-scored bake-off. Keep **Amazon Translate** as a technically qualified fallback, but only advance it if an AWS Organizations AI-services opt-out policy and regional-data review are acceptable: AWS says Amazon Translate may store inputs, use them to improve AWS AI/ML technologies, and move some content to another region for improvement unless the customer opts out [W5]. This is a shortlist, not a provider selection.

The alpha should use machine translation only to create **drafts** in the editor. It should persist reviewed Managed Translations in the application's own model, never treat a provider response as published content, and never send student answers. A small server-side provider adapter, a canonical application-owned glossary, stable segment IDs, source-revision tracking, and an explicit human review state keep the editor workflow portable.

Clinical and preventive-care wording needs qualified human review before publication in every locale. As a useful safety baseline, 45 CFR 92.201 requires covered health entities to use qualified translators and requires qualified-human review of machine translation when accuracy is essential or the material is complex, non-literal, or technical [S1]. Whether or not this app is legally a covered entity, its health content meets that risk description.

**Map gist:** Google, Azure, AWS, and DeepL all document Haitian Creole support; take Google/Azure/DeepL to a clinical-quality bake-off behind a provider-neutral, human-reviewed Managed Translation workflow, never sending student answers.

## Scope and hard filters

The translation input allowlist is author-controlled content only:

- interface strings;
- Learning Module titles, instructions, explanations, and other authored body content;
- intake question prompts; and
- predefined intake answer-option labels.

Student answers, free-text responses, uploaded work, names, identifiers, and other learner-provided data are out of scope and must be rejected before the provider adapter. This materially reduces privacy risk but does not remove the need to assess authored intake text for sensitive operational details.

A service passes the initial filter only if its first-party documentation supports text translation for English (`en`), Spanish (`es`), Portuguese (`pt`, with the product decision later specifying Brazilian or European Portuguese), French (`fr`), and Haitian Creole (`ht`). A first-party claim that a general-purpose model is "multilingual" without a documented language list is not enough.

## Evidence-backed comparison

| Criterion | Google Cloud Translation Advanced | Azure Translator | Amazon Translate | DeepL API |
| --- | --- | --- | --- | --- |
| Required languages | Pass. The NMT list includes `en`, `es`, `pt`, `fr`, and Haitian Creole `ht`; Google says any language in the NMT list can translate to any other [G1]. | Pass. The language matrix marks cloud text and document translation for all five, including `ht`; `pt` defaults to Brazilian Portuguese [A1]. | Pass. The supported-language table includes all five and country variants for French and Portuguese [W1]. | Pass. The current API language matrix includes all five and marks Haitian Creole `HT` for translation [D1]. |
| Editor API and SDK fit | REST plus official C#, C++, Go, Java, Node.js, PHP, Python, and Ruby clients [G2]. `translateText` accepts arrays but translates one target language per call. | REST can accept an array and repeated `to` parameters for multiple targets in one call [A2]. Official GA text SDKs exist for C#, Java, JavaScript, and Python [A3]. | `TranslateText` is a simple regional JSON API; AWS publishes SDK bindings for .NET, C++, Go, Java, JavaScript, Kotlin, PHP, Python, and Ruby [W2]. One target per real-time call. | REST plus official C#, Java, JavaScript, PHP, Python, and Ruby clients [D2]. Up to 50 text entries fit in one synchronous request [D3]. |
| Terminology and glossary | Strong fit. Advanced glossaries support directional pairs or multilingual equivalent-term sets, CSV/TSV/TMX, and use with text or batch requests [G3]. Google recommends retaining the source glossary because the hosted resource has no version control [G3]. | Mixed for editor text. Dynamic Dictionary can inject exact translations when one side is English, but Microsoft says it is safe only for proper names/compound nouns and becomes hard to maintain at scale [A4]. Document Translation supports CSV/TSV/XLIFF glossaries [A5], but that file workflow is awkward for editor fragments. Custom Translator does **not** list Haitian Creole support [A1]. | Good baseline. Custom terminology files can force desired brand/domain terms, though AWS explicitly does not guarantee every target term is used [W3]. One terminology resource can be attached to a request [W2]. | Potentially strong but requires a pre-decision verification. Current v3 glossary docs say dictionaries can be created for any glossary-supported language and the API specification says all supported languages except Thai [D4] [D5], while the generated language matrix marks Haitian Creole translation support but not glossary support [D1]. Query `GET /v3/languages?resource=glossary` in the target account and test `en` to `ht` before treating this as resolved. |
| Data use and retention | Best explicit terms in this set. Google says content is used only to provide the API, is held briefly in memory, is not used to train/improve translation, and is not shared with third parties [G4]. Glossary resources are persistently stored, encrypted, and IAM-controlled [G4]. | Strong. Microsoft says text is not stored and document data is temporarily stored only during processing, then hard-deleted; no customer translation data persists [A6]. | Highest policy burden. AWS may store and use inputs to provide the service and improve Amazon AI/ML, permits an Organizations opt-out policy, and publishes no fixed Translate input-retention period. The service guide also says support can be contacted to request deletion and future non-storage [W5] [W6]. | Use a paid plan, not the free developer service, for any potentially sensitive content. Paid Pro terms say content is normally stored only as technically needed; exceptional error traces may be encrypted for up to 72 hours. The free API reserves the right to store content perpetually and forbids personal data [D6]. DeepL says business text is not used for training without consent [D7]. |
| Regional processing | Advanced offers US and EU multi-regional endpoints; at-rest data and ML processing stay in the selected continental boundary. These endpoints exclude custom AutoML models and pre-GA features [G5]. | Geographic endpoints keep text processing within Americas, Asia Pacific, Europe, or Switzerland; the global endpoint can fail over outside the geography [A7]. Document processing follows the resource geography [A8]. | Requests use regional endpoints and batch is available in a documented subset of regions [W7] [W4]. However, AWS says improvement copies may cross regions unless the data-use path is disabled [W5]. | EU is the default. US and Japan regional endpoints process/store in-region but require a signed regional deployment addendum; an account is tied to one region [D8]. |
| Pricing relevant to alpha | NMT text is free for the first 500,000 characters each month via a $10 credit, then **$20 per million source characters per target**. Batch multiplies source characters by target count [G6]. | F0 includes 2 million characters/month; the public US retail meter lists S1 standard translation at **$10 per million characters**. Each target is billed separately [A9] [A10]. | Standard real-time and batch translation are **$15 per million characters**. The free tier is 2 million characters/month for 12 months [W8]. | First-party help currently documents both API Free (500,000 characters/month) and newer Developer/Growth plan language; paid plans combine a base charge with character usage, and displayed rates vary by market/plan [D9]. Obtain the applicable quote during the decision ticket rather than copying a stale web price. |
| Quotas and request behavior | Synchronous Advanced: recommended 5,000 and maximum 30,000 code points/request; default 6 million characters/minute. Async batch: 100 files, 10 targets, 100 million code points, with Cloud Storage input/output [G7] [G8]. | Text: 50,000 characters across all targets and up to 1,000 array items/request. F0 allows 2 million/hour and S1 40 million/hour [A9]. Async Document Translation supports 1,000 files, 250 MB, and 10 targets but requires Blob Storage [A8] [A9]. | Real-time text: 10,000 bytes/request. Async batch: 5 GB, 1 million documents, 10 targets, and 10 concurrent jobs, using S3 [W6]. | Text is synchronous: 50 texts and 128 KiB/request; scale by parallel calls and retry/backoff [D3] [D10]. Document translation is a separate upload/poll/download flow. |
| Clinical review implications | Glossaries and optional English-to-Haitian custom NMT support are useful, but neither establishes clinical accuracy [G1] [G3]. Evaluate the default NMT path first to avoid premature training lock-in. | Low-cost multi-target calls are attractive. The absence of Haitian Creole in Custom Translator and text-dictionary limitations make a reviewer-maintained application glossary and output QA especially important [A1] [A4]. | Terminology is useful but not guaranteed. AWS itself presents raw output as suitable where some imperfection is acceptable and calls human post-editing appropriate for higher-value content [W5]. | Context input can improve short-string disambiguation, but each batched text is otherwise independent [D3]. The terms disclaim correctness/accuracy of API output [D6]. Haitian Creole glossary behavior must be proven. |
| Lock-in pressure | Provider resource names, GCS batch files, glossary location, Google auth/IAM, and optional custom model IDs. | Azure resource/region headers, Dynamic Dictionary markup, Blob workflows, and Custom Translator category IDs. | IAM roles, S3 batch workflow, terminology and parallel-data resources, regional configuration, and an organization-level opt-out control. | DeepL-specific `context`, glossary IDs, v2 translation/v3 glossary split, plan semantics, and a regional addendum. |

### Shortlist for the later decision ticket

Advance these three to the same evaluation harness; do not choose among them from documentation alone:

1. **Google Cloud Translation Advanced:** strongest explicit no-training/no-retention language, documented US/EU processing, mature glossary support, and a documented English-Haitian custom-model path. Trade-offs are the highest published standard per-character price in this comparison and GCP-specific glossary/batch resources.
2. **Azure Translator:** lowest published standard per-character price, efficient multi-target text calls, strong no-persistence language, and geographic endpoints. The bake-off must test whether Dynamic Dictionary is adequate for Haitian Creole clinical terminology because Custom Translator does not support `ht`.
3. **DeepL paid API:** now passes the Haitian Creole filter, has useful context handling, paid-plan retention terms, and regional options. Before quality testing, resolve the contradictory first-party Haitian Creole glossary documentation and obtain current paid pricing/regional terms.

Amazon Translate remains a valid control or fallback for the bake-off if the team already has AWS governance. Its $15/million standard price, terminology, SDKs, and batch service are credible [W2] [W3] [W8]. It is not in the recommended alpha three because its default data-improvement and possible cross-region terms add an avoidable governance prerequisite [W5], not because of language or API capability.

### Eliminated by the language filter

| Service | Reason for elimination |
| --- | --- |
| Oracle Translate | Oracle's first-party supported-language list includes English, Spanish, Portuguese, and French but not Haitian Creole [O1]. |
| NAVER Cloud Papago Translation | Papago's API list omits Haitian Creole and Portuguese; its supported pairs are centered on Korean, English, Japanese, and Chinese plus a limited set of other languages [N1]. |

General-purpose LLM APIs are not added to the shortlist merely because they can sometimes produce Haitian Creole. The hard filter requires documented language support, and a translation-specific service offers clearer metering, segment handling, terminology controls, and operational limits. A later decision can add an LLM only if it supplies contractual data terms and passes the same human-scored test set; this research does not make that expansion.

## Provider-independent integration guidance

### Keep the service behind one narrow server-side port

Expose a provider-neutral operation such as:

```text
generateDraftTranslations({
  sourceLocale,
  targetLocales,
  segments: [{ segmentId, text, contentKind, context }],
  glossaryVersion
}) -> [{ segmentId, targetLocale, draftText, provenance }]
```

The application, not the provider, owns segmentation and stable IDs. The adapter is responsible for provider language codes, batching, glossary export, retries, rate limits, and mapping ordered responses back to IDs. Keep credentials and API calls on the server; never expose provider keys in the editor client.

Use two execution patterns over the same port:

- **Interactive draft:** translate a field, question, answer-option set, or selected editor block synchronously and show a pending draft quickly.
- **Bulk draft:** enqueue all changed segments in a Learning Module, fan out by target locale, and persist progress. The app's queue should be the durable job abstraction even when the provider offers only synchronous text calls. Provider-native S3/GCS/Blob batch jobs are unnecessary for normal editor-sized records and create extra storage coupling.

Make requests idempotent on `(content identity, source revision, target locale, glossary version, adapter version)`. Cache or reuse a draft only for the same tuple. A source edit must mark previous target translations stale rather than silently continuing to publish them.

### Make student-answer exclusion structural

Do not depend on a UI warning. The translation command should accept only explicit content kinds:

```text
interface_string | learning_module_field | intake_question | intake_answer_option
```

Reject unknown kinds and any resource owned by a student-submission aggregate. Build the outbound provider payload from authored-content records fetched by ID on the server, not from arbitrary text supplied by the browser. Log content IDs, counts, provider request IDs, and byte/character totals, but not source or translated text.

### Own the glossary

Store a canonical term base in the application or version-controlled data, with source term, target term by locale, definition/context, content domain, case-sensitivity intent, reviewer, approval state, and revision. Generate provider-specific GCP glossary files, Azure markup/document glossaries, AWS terminology files, or DeepL dictionaries from that source.

The canonical glossary is reviewed clinical content. A provider glossary resource is only a compiled deployment artifact. Record the canonical glossary revision on every generated draft. Do not make a provider glossary ID the source of truth.

### Model reviewed Managed Translations independently

A provider-independent record should contain at least:

| Field | Purpose |
| --- | --- |
| `id` | Application identity for the Managed Translation. |
| `contentKind`, `contentId`, `fieldPath` | Stable pointer to the authored source segment without encoding a provider resource name. |
| `sourceLocale`, `targetLocale` | Application BCP 47 locale tags; adapters map them to provider codes. |
| `sourceRevision` or `sourceHash` | Detects staleness when authored source content changes. |
| `draftText` | Latest machine-generated proposal; never implicitly published. |
| `reviewedText` | Human-edited, approved wording kept separate from regenerated drafts. |
| `status` | `machine_draft`, `in_review`, `approved`, `published`, `stale`, or `rejected`. |
| `glossaryRevision` | Canonical terminology version used for generation/review. |
| `provenance` | Provider key, model/feature name when returned, adapter version, request ID, and generation time. Diagnostic only, not part of record identity. |
| `reviewedBy`, `reviewedAt`, `reviewNotes` | Human accountability and audit trail. |
| `publishedAt` | Explicit publication event; only approved, non-stale records qualify. |

Preserve the reviewed text when a new machine draft is generated. Present a source/reviewed/new-draft diff to the reviewer rather than overwriting approved work. This lets a later provider switch generate new drafts while retaining the application's translation memory, approvals, and audit history.

## Safety and review workflow

Machine translation must not be represented as clinically reviewed. Every provider disclaims or qualifies output quality in some form; terminology controls improve consistency but do not prove that contraindications, negation, dosage/frequency, anatomy, screening intervals, or answer-option distinctions remain correct [W3] [D6].

Use the following publication gate:

1. An editor creates or updates English source content using plain language and unambiguous placeholders.
2. The service generates per-locale machine drafts with canonical glossary revision and provenance.
3. A qualified target-language reviewer edits for meaning, register, dialect, literacy level, cultural fit, and completeness.
4. A reviewer with preventive-care/clinical subject expertise checks safety-critical meaning. One person can fill both roles only if qualified in both.
5. Automated checks compare numbers, dates, URLs, placeholders, option counts/order, negations, and glossary terms; failures block approval.
6. Approval records the source revision. Publishing is allowed only from `approved` and only while the source revision still matches.
7. Material source or glossary changes mark translations `stale` and require review again.

Build the later bake-off from representative, versioned content across all four allowed content categories. Include short ambiguous interface strings, long Learning Module paragraphs, screening ages/intervals, negation, idioms, and answer options whose distinctions must survive translation. Qualified reviewers should score adequacy/meaning, fluency, terminology, literacy, cultural appropriateness, placeholder preservation, and critical errors separately for Spanish, Portuguese, French, and especially Haitian Creole. Do not infer Haitian Creole quality from performance in higher-resource languages.

The HHS rule is a legal requirement only where its coverage conditions apply, so legal counsel should determine applicability. It is nevertheless an appropriate minimum safety design: machine-generated technical health language remains a draft until reviewed by a qualified human translator [S1].

## Decision-ticket questions

The later provider decision should resolve these with test-account evidence rather than more marketing comparison:

- Which service has the lowest critical-error rate on the same Haitian Creole and other locale test set?
- Can reviewers enforce the canonical clinical term base for `en` to `ht`, especially in Azure text calls and DeepL's target account?
- Which Portuguese and French variants does the product require (`pt-BR` versus `pt-PT`, `fr` versus `fr-CA`), and how does each provider perform on them?
- Is US-only processing required, and are paid plan/addendum terms acceptable?
- What expected source-character volume multiplied by four targets makes the current all-in monthly cost?
- Does the organization already operate GCP, Azure, or AWS identity, billing, logging, and vendor agreements strongly enough to outweigh API-level differences?
- Can the selected service's contract, not just public documentation, confirm retention, training/data-use, subprocessors, incident handling, and any healthcare/privacy requirements?

## Primary sources

All provider claims above use first-party documentation, terms, pricing, or APIs. Pricing and language coverage can change and must be rechecked when the provider decision is made.

### Google Cloud

- **[G1]** [Cloud Translation language support](https://cloud.google.com/translate/docs/languages)
- **[G2]** [Cloud Translation Advanced client libraries](https://cloud.google.com/translate/docs/reference/libraries/v3/overview-v3)
- **[G3]** [Creating and using glossaries](https://cloud.google.com/translate/docs/advanced/glossary)
- **[G4]** [Cloud Translation data usage FAQ](https://cloud.google.com/translate/data-usage)
- **[G5]** [Global and multi-regional endpoints](https://cloud.google.com/translate/docs/advanced/endpoints)
- **[G6]** [Cloud Translation pricing](https://cloud.google.com/translate/pricing)
- **[G7]** [Cloud Translation quotas and limits](https://cloud.google.com/translate/quotas)
- **[G8]** [Cloud Translation Advanced batch requests](https://cloud.google.com/translate/docs/advanced/batch-translation)

### Microsoft Azure

- **[A1]** [Azure Translator language support](https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support)
- **[A2]** [Translator v3 Translate method](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)
- **[A3]** [Azure Text Translation SDKs](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/sdk-overview)
- **[A4]** [Azure Dynamic Dictionary](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/how-to/use-dynamic-dictionary)
- **[A5]** [Create and use a Document Translation glossary](https://learn.microsoft.com/en-us/azure/ai-services/translator/document-translation/how-to-guides/create-use-glossaries)
- **[A6]** [Data, privacy, and security for Azure Translator](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/translator/data-privacy-security)
- **[A7]** [Translator v3 base URLs and data geographies](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/reference)
- **[A8]** [Azure Document Translation overview](https://learn.microsoft.com/en-us/azure/ai-services/translator/document-translation/overview)
- **[A9]** [Azure Translator service limits](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)
- **[A10]** [Azure Translator pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/) and [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=contains(productName,%27Translator%27))

### Amazon Web Services

- **[W1]** [Amazon Translate supported languages](https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html)
- **[W2]** [`TranslateText` API and SDK references](https://docs.aws.amazon.com/translate/latest/APIReference/API_TranslateText.html)
- **[W3]** [Custom terminology](https://docs.aws.amazon.com/translate/latest/dg/how-custom-terminology.html)
- **[W4]** [Asynchronous batch processing](https://docs.aws.amazon.com/translate/latest/dg/async.html)
- **[W5]** [Amazon Translate FAQ, including data privacy](https://aws.amazon.com/translate/faqs/)
- **[W6]** [Amazon Translate guidelines and quotas](https://docs.aws.amazon.com/translate/latest/dg/what-is-limits.html)
- **[W7]** [Amazon Translate regional endpoints](https://docs.aws.amazon.com/general/latest/gr/translate-service.html)
- **[W8]** [Amazon Translate pricing](https://aws.amazon.com/translate/pricing/)

### DeepL

- **[D1]** [DeepL API supported languages and per-feature matrix](https://developers.deepl.com/docs/getting-started/supported-languages)
- **[D2]** [DeepL official client libraries](https://developers.deepl.com/docs/getting-started/client-libraries)
- **[D3]** [DeepL text translation API](https://developers.deepl.com/api-reference/translate/request-translation)
- **[D4]** [Managing DeepL v3 glossaries](https://developers.deepl.com/docs/customize/managing-glossaries)
- **[D5]** [DeepL multilingual glossary API](https://developers.deepl.com/api-reference/multilingual-glossaries/create-a-glossary)
- **[D6]** [DeepL Pro terms and conditions](https://www.deepl.com/en/pro-license)
- **[D7]** [DeepL enterprise data security](https://www.deepl.com/en/pro-data-security)
- **[D8]** [DeepL regional API endpoints](https://developers.deepl.com/docs/getting-started/regional-endpoints)
- **[D9]** [DeepL API usage and billing](https://support.deepl.com/hc/en-us/articles/360020685720-Usage-count-and-billing-in-DeepL-API)
- **[D10]** [Translating large volumes with DeepL](https://developers.deepl.com/docs/translate/translating-large-volumes)

### Eliminated alternatives and safety baseline

- **[O1]** [Oracle Translate supported languages](https://docs.oracle.com/en-us/iaas/Content/language/using/translate.htm)
- **[N1]** [NAVER Cloud Papago text translation API and supported pairs](https://api.ncloud-docs.com/docs/en/ai-naver-papagonmt-translation)
- **[S1]** [45 CFR 92.201, meaningful access for individuals with limited English proficiency](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-A/part-92/subpart-C/section-92.201)
