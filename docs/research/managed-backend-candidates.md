# Managed Backend Candidates for the Alpha Foundation

Research for [issue #4](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/4), completed 2026-08-11.

## Question

Which managed relational backend platforms are credible candidates for the alpha given server-side email one-time-code authentication, role-based authorization, sensitive-record safeguards, auditability, managed files, low operational burden, a React client, and a future installable offline student app, and what material trade-offs distinguish them?

## Finding

Three candidate shapes are credible enough to inform the architecture decision:

1. **Supabase** is the strongest low-operations baseline. It combines PostgreSQL, six-digit email OTP, durable sessions, row-level security, generated data APIs, managed files, functions, and database auditing in one product. Its principal gaps are application-level audit design, offline synchronization, and commercial/compliance-plan validation.
2. **Firebase SQL Connect** (the current name of Firebase Data Connect) is a credible Google-centric relational option. It provides a managed PostgreSQL-backed service, generated React SDKs, operation-level authorization, managed files, and first-party integration paths to Cloud Translation. Its material gaps are the lack of a native numeric email-entry-code flow in Firebase Authentication and the lack of SQL Connect offline mutation synchronization.
3. **An AWS managed-service composition** offers the broadest infrastructure controls and now has native Cognito email OTP, but it is not an integrated backend-as-a-service. Cognito, an API layer, PostgreSQL, files, secrets, audit systems, and translation must be assembled and operated as one application platform.

This report does **not** select the alpha backend. Supabase should be the reference candidate in the later architecture decision; Firebase SQL Connect should remain in that decision if a Google-centric platform is strategically valuable; AWS should remain the control/compliance comparator and become the implementation favorite only if district requirements justify its additional burden.

## Current Prototype Baseline

The existing prototype is a React/Vite static SPA on GitHub Pages with Google Sheets and Apps Script as its backend (`README.md`). Its current behavior makes the backend replacement consequential:

- Students request and enter a six-digit email code, then the browser stores a custom 24-hour session in `sessionStorage` (`src/features/auth/SignInPage.tsx`, `src/utils/studentSession.ts`).
- Learning progress, badges, user data, and intake completion state live in `localStorage`, so progress is not durable across devices (`src/context/AppStateContext.tsx`).
- Intake records are encrypted before storage, but student-side decryption reads a district passcode from a `VITE_*` build variable, including an insecure fallback. Vite build values are available to the browser, so this is not an appropriate server secret boundary (`src/hooks/useStudentFormData.ts`, `README.md`).
- The planned alpha has one School Workspace, manually provisioned access, email invitations and one-time codes, distinct administrative and clinical permissions, one Intake Record per student, and no alpha offline synchronization ([wayfinder map #1](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/1)).

Any candidate therefore needs to replace browser-only identity and progress state, not merely replace the submission spreadsheet.

## Evaluation Frame

The comparison asks whether each candidate can support:

- Six-digit email OTP without keeping OTP secrets or verification logic in the browser.
- Revocable sessions that can survive refreshes and work across devices.
- Student, nurse-administrative, and nurse-clinical permissions with school and record isolation enforced server-side.
- PostgreSQL as the durable source of truth for workspace configuration, invitations, Intake Records, and progress.
- Narrow access to sensitive Intake Records, server-held secrets, encryption, backups, and a domain audit trail.
- Private file storage and server-side translation integration.
- A React client with low operational burden for an alpha of fewer than 100 students, without making that count a product limit.
- A later installable PWA that can cache content and eventually synchronize progress without changing the authoritative data model.

"Native" below means the vendor documents a first-party capability. It does not mean that the capability is secure without application schema, policy, testing, monitoring, and operational work.

## Candidate Matrix

| Capability | Supabase | Firebase SQL Connect | AWS managed composition |
| --- | --- | --- | --- |
| Email entry-code OTP | **Native.** Supabase Auth sends and verifies six-digit email OTPs; automatic signup can be disabled. | **Custom for the required UX.** Firebase Auth natively documents passwordless email **links**, not a user-entered email code. Preserve the six-digit flow with a custom server flow and Firebase custom token, or change the product decision to email links. | **Native.** Cognito choice-based `USER_AUTH` supports `EMAIL_OTP`; feature-plan and MFA compatibility must be checked. |
| Durable/revocable sessions | **Native.** JWT access token plus rotating refresh token; time-box, inactivity, and single-session controls are paid-plan features. | **Native.** Firebase Auth persists browser auth state and refreshes tokens; Admin SDK supports revocation. Shared-device persistence must be configured deliberately. | **Native.** Cognito issues ID, access, and refresh tokens and supports refresh-token revocation. The app still owns secure browser storage and API validation. |
| Roles and school isolation | **Strong native primitives.** Auth claims plus PostgreSQL RLS can enforce workspace, role, and row constraints even for browser-to-database API access. Policies are application code and require adversarial tests. | **Native operation authorization.** SQL Connect `@auth` and CEL expressions can constrain each deployed query/mutation using Firebase Auth claims. School and role claims, safe operation definitions, and tests remain custom. | **Composable.** Cognito groups/claims can authorize API routes; school isolation and clinical permissions must then be enforced in Lambda/API code and PostgreSQL. More seams mean more policy-drift risk. |
| Managed relational source of truth | **Native PostgreSQL** with migrations, generated REST/GraphQL access, backups, and optional PITR depending on plan/add-ons. | **Native managed PostgreSQL path.** SQL Connect uses Cloud SQL for PostgreSQL and generates type-safe web SDKs from deployed operations. | **Native infrastructure, custom application API.** RDS for PostgreSQL or Aurora PostgreSQL provides backups, PITR, Multi-AZ options, and VPC controls; API Gateway/Lambda or AppSync must expose the domain API. |
| Sensitive Intake Record safeguards | RLS can narrowly separate student self-access from same-workspace clinical read access. High-risk workflows can be forced through Edge Functions. Key management, minimization, retention, and application audit events remain custom. | Authorization can be attached to only the generated operations that the client is allowed to invoke; privileged workflows can run in Functions/Admin SDK. Data classification, encryption-key choices, retention, and application audit events remain custom. | API-only record access, KMS, Secrets Manager, private networking, and granular IAM offer the most control. The application must correctly combine all of them, including tenant context and least-privilege database access. |
| Auditability | Auth/API logs and PostgreSQL `pgaudit` are available. Platform audit logs and retention vary by plan. A human-readable append-only trail such as "nurse viewed Intake Record" is still application work. | SQL Connect emits Google Cloud audit logs and deployment-time authorization assessments. These do not replace an application audit table describing record views and decisions. | CloudTrail covers AWS API activity and RDS supports `pgaudit`. Application events, log routing/retention, alerting, and correlation across services are custom. |
| Managed files | **Native.** Supabase Storage uses RLS on storage metadata. | **Native companion service.** Cloud Storage for Firebase uses path-based Security Rules integrated with Firebase Auth. | **Native companion service.** S3 is private by default and supports IAM/bucket policies, KMS, versioning, and object-level logging. Signed upload/download flows are custom. |
| Translation integration | Edge Functions can call a selected translation provider while keeping credentials server-side. There is no first-party Supabase translation service. | Cloud Functions or Cloud Run can call first-party Cloud Translation; terminology glossaries are available. Translation workflow and review state remain application data. | Lambda can call Amazon Translate. IAM integration is direct, but the translation workflow and review state remain application data. |
| Cross-device progress | Straightforward server-side progress tables protected by RLS; conflict/version semantics are custom. | Straightforward SQL Connect queries/mutations; conflict/version semantics are custom. | Straightforward through the custom API and PostgreSQL; conflict/version semantics are custom. |
| Future PWA/offline sync | Static assets/content can be cached, but Supabase does not provide a documented PostgreSQL offline-write/sync client. IndexedDB queueing, idempotency, conflict policy, and reconciliation are custom. | SQL Connect does not document Firestore-style offline mutation persistence. Adding Firestore would provide offline capabilities but create a second data model/source-of-truth problem. A SQL-first custom sync layer is still needed. | A relational API does not gain offline sync from AWS automatically. AppSync/Amplify offline-oriented patterns generally introduce a different data layer; a PostgreSQL-first PWA needs custom local storage and sync. |
| Relative alpha operations | **Low.** One integrated project and policy model, but SMTP, migrations, backups, logs, and secrets still need ownership. | **Low to medium.** Integrated client tooling, but Firebase Auth, SQL Connect/Cloud SQL, Storage, and Functions are distinct surfaces. | **High.** The most infrastructure and IAM surfaces, deployment units, log streams, and pricing dimensions. Infrastructure as code is effectively mandatory. |

## Candidate Details

### 1. Supabase

Supabase most directly matches the desired shape. Its [passwordless email documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless) explicitly supports a six-digit OTP and `shouldCreateUser: false`, which fits a manually provisioned roster. Its [session model](https://supabase.com/docs/guides/auth/sessions) provides short-lived access JWTs and rotating refresh tokens; paid plans add time-boxed, inactivity, and single-session controls.

Its distinguishing advantage is that authorization can live at the data boundary. Supabase requires RLS on exposed tables and maps authenticated requests into PostgreSQL policies. The [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) documents both the protection and important hazards: service keys bypass RLS, user-editable metadata must not hold authorization facts, views can bypass policies unless configured correctly, and JWT claims can be stale. The [RBAC guide](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) shows server-issued role claims feeding RLS policies.

A plausible later design is `school_id` on every tenant-owned row, server-managed membership/role rows, and policies that require both membership in the row's school and the exact permission. Clinical reads should also create an application audit event. The browser must never receive a service key or district-wide encryption secret.

Files use the same policy vocabulary: [Supabase Storage authorization](https://supabase.com/docs/guides/storage/security/access-control) is implemented through RLS on `storage.objects`. Database activity can be selectively recorded with [`pgaudit`](https://supabase.com/docs/guides/database/extensions/pgaudit), but query logs are not a complete domain audit trail and overly broad logging can expose sensitive information or consume retention quickly.

Material caveats:

- Direct browser data access makes RLS correctness a release gate, not a convenience. Policy tests must prove cross-student, cross-role, and future cross-workspace denial.
- OTP email delivery needs production SMTP configuration, abuse/rate-limit controls, and a decision about whether unknown emails reveal roster membership.
- Session timeout controls, platform audit logs, log retention, backups/PITR, and compliance features vary by paid tier. The [pricing page](https://supabase.com/pricing) currently places platform audit logs and HIPAA availability above the base Pro tier and prices PITR separately.
- Supabase's [HIPAA project guidance](https://supabase.com/docs/guides/platform/hipaa-projects) requires a signed BAA, a paid HIPAA add-on, High Compliance configuration, PITR, SSL enforcement, network restrictions, and connection logging when PHI is processed. This does not establish that HIPAA applies to this school record or that a configured application is compliant.
- No Supabase-specific FERPA contractual assertion was found in the reviewed official documentation. Procurement/legal review must inspect the actual agreement, data-processing terms, deletion/export commitments, subprocessors, incident terms, and state-law requirements.
- Offline write synchronization is application work. The later PWA should keep authoritative IDs, versions, and idempotency fields in PostgreSQL now so a local queue can be added without replacing the model.

### 2. Firebase SQL Connect

Firebase SQL Connect is a fully managed PostgreSQL application layer backed by Cloud SQL, with schema/operation deployment and generated SDKs, including React integrations ([overview](https://firebase.google.com/docs/sql-connect), [React quickstart](https://firebase.google.com/docs/sql-connect/quickstart/react)). Unlike a generic browser SQL connection, clients invoke operations that were defined and deployed on the server.

Authorization is attached to those operations. The [authorization guide](https://firebase.google.com/docs/sql-connect/authorization-and-security) documents `@auth` levels and CEL expressions based on Firebase Authentication tokens, plus deployment-time assessments that flag broad access. This can express student ownership, school membership, and role checks, but every exposed operation must carry the right constraint. Custom claims should be server-controlled and their refresh/revocation behavior included in tests.

The largest product mismatch is authentication. Firebase Authentication's native passwordless email flow is an [email sign-in link](https://firebase.google.com/docs/auth/web/email-link-auth), while the alpha notes currently require a one-time code that a student enters. Two paths exist, and they are a product/architecture decision rather than an implementation detail:

1. Accept email links and use Firebase Auth natively.
2. Preserve six-digit codes by implementing generation, hashing, expiration, attempt limits, email delivery, and verification in a trusted function, then issue a [Firebase custom token](https://firebase.google.com/docs/auth/admin/create-custom-tokens). This restores the current UX but gives up an important managed-auth benefit.

Firebase Auth can persist sessions across reloads or restrict them to a tab; the [web persistence guide](https://firebase.google.com/docs/auth/web/auth-state-persistence) specifically calls out shared-device choices. Admin tooling can [revoke refresh tokens](https://firebase.google.com/docs/auth/admin/manage-sessions). Cloud Storage's [Security Rules](https://firebase.google.com/docs/storage/security) integrate with Firebase Auth for user/path constraints.

Material caveats:

- SQL Connect and Cloud SQL create a non-zero database baseline even at very small scale. Review the current [SQL Connect pricing](https://firebase.google.com/docs/sql-connect/pricing), Cloud SQL instance/storage/backups, network egress, Authentication/Identity Platform, Storage, Functions, Logging, and Translation together rather than comparing one headline price.
- [SQL Connect Cloud Audit Logs](https://firebase.google.com/docs/sql-connect/cloud-audit-logging) cover service activity; a domain audit ledger for Intake Record access remains application work.
- [Cloud Translation](https://cloud.google.com/translate/docs/overview) is a strong first-party integration, including glossaries, but generated text must still enter the app's draft/review/publication workflow. Sensitive Intake Record values should not be submitted for translation unless that use is explicitly approved.
- Firestore has documented [offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline), but SQL Connect is the relational candidate and does not inherit that behavior. Splitting progress into Firestore solely for sync creates dual authorization, audit, retention, and consistency models.
- Google Cloud's [HIPAA page](https://cloud.google.com/security/compliance/hipaa-compliance) requires an accepted BAA, use of listed covered products, and customer-implemented controls. A later review must verify every chosen Firebase/Google service against the then-current BAA, not infer coverage from Cloud SQL alone.
- Google Cloud's public [FERPA page](https://cloud.google.com/security/compliance/ferpa) describes Google Workspace for Education and its agreement. It does not, by itself, establish FERPA terms for a Firebase SQL Connect workload. The actual Firebase/Google Cloud contracts need district/legal review.

### 3. AWS Managed-Service Composition

The AWS candidate is a composition rather than one platform:

- Cognito User Pools for student and nurse identity.
- API Gateway plus Lambda, or AppSync resolvers, as the only application data boundary.
- RDS for PostgreSQL or Aurora PostgreSQL as the source of truth.
- S3 for private files; KMS and Secrets Manager for keys and server secrets.
- CloudTrail, CloudWatch, RDS logs/`pgaudit`, and an application audit table.
- Amazon Translate behind Lambda if that service wins the separate translation decision.

Cognito now natively supports passwordless email OTP through choice-based `USER_AUTH`. The [authentication-flow documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-authentication-flow-methods.html) shows `EMAIL_OTP` challenges and also records a material constraint: OTP first-factor authentication is incompatible with required MFA and with users who have activated MFA in an optional-MFA pool. Cognito feature-plan pricing and email-delivery configuration must be included in the estimate.

Cognito [issues ID, access, and refresh tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html), includes group claims, and supports token customization and revocation. Those claims only establish identity context. Lambda/API code must apply permission and school rules consistently, and database access must not silently collapse all requests into an unrestricted shared role without preserving tenant context.

[RDS for PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html) supplies snapshots, point-in-time restore, Multi-AZ options, VPC placement, and TLS. It supports [`pgaudit`](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.pgaudit.html) for detailed database activity. [S3 access controls](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-overview.html) provide private-by-default object storage, IAM and bucket policies, public-access blocking, encryption, versioning, and Object Lock options.

Material caveats:

- AWS provides the most knobs but the fewest application defaults. Least-privilege IAM, networking, deploy pipelines, alarms, backup checks, log retention, key rotation, and incident access all need explicit ownership.
- Control-plane CloudTrail and SQL audit logs do not replace a domain event such as who viewed which Intake Record, under which school/permission, and why.
- Costs are distributed across Cognito, email, API requests, Lambda, database compute/storage/backups/I/O, S3, KMS, Secrets Manager, logging, monitoring, and translation. Build a workload estimate in the [AWS Pricing Calculator](https://calculator.aws/) after the API/database topology is known.
- AWS states that a BAA can be accepted and that PHI may only be processed in services on the current [HIPAA Eligible Services Reference](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/). AWS also explicitly says there is no general "HIPAA certification" for a cloud provider ([HIPAA program page](https://aws.amazon.com/compliance/hipaa-compliance/)). Every service in the composition must be checked.
- AWS's [FERPA page](https://aws.amazon.com/compliance/ferpa/) describes tools and a shared-responsibility approach; AWS does not know how a customer classifies or configures its data. Application and district obligations remain with the customer.
- A PostgreSQL-backed API has no automatic PWA synchronization. Adding an offline-oriented AWS data product later could produce the same dual-source-of-truth problem as pairing SQL Connect with Firestore.

## Cross-Cutting Security and Compliance Caveats

Platform selection cannot settle the record's legal classification. Federal joint guidance explains that health records maintained by a school or its agent may be education records governed by FERPA and excluded from HIPAA, while different institutional contexts can produce different results ([U.S. Department of Education and HHS joint guidance](https://studentprivacy.ed.gov/resources/joint-guidance-application-ferpa-and-hipaa-student-health-records)). Issue [#2](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/2) separately researches the applicable Massachusetts and school-health obligations.

For all candidates:

- Treat Intake Records as sensitive regardless of whether they are ultimately classified under FERPA, HIPAA, state law, district policy, or several obligations.
- Obtain district/legal approval of the actual contract, data-processing terms, service list, region, subprocessors, retention/deletion, breach terms, and BAA if applicable. A vendor compliance page is not an application compliance determination.
- Put authorization at the server/data boundary. Hiding nurse routes or buttons in React is not authorization.
- Keep `school_id`, user ID, role/permission, and record ID explicit in policy and audit data. Do not trust school or role values supplied by the browser.
- Separate ordinary student/progress access from clinical Intake Record access. Do not send district-wide secrets, privileged keys, or reusable decryption secrets to the browser.
- Create an append-only application audit event for sensitive reads and writes. Vendor logs are supporting evidence, not a substitute for domain semantics.
- Define retention, correction, deletion, backup restoration, and export restrictions before choosing encryption keys. Client-side ciphertext alone does not solve access control or lifecycle obligations.
- Redact sensitive values from logs and error reporting. Broad SQL parameter or response logging can create a second sensitive-data store.
- Test denial paths: another student, another class, wrong role, revoked invitation, expired session, removed nurse, and eventually another School Workspace.

## Offline and Progress Implications

None of the three relational shapes eliminates the later offline design problem. The safe alpha constraint is to make the server authoritative now and preserve a synchronization seam:

- Give progress mutations stable client-generated operation IDs for idempotency.
- Store server timestamps and explicit versions rather than inferring order from browser clocks.
- Decide whether progress is a latest snapshot, per-skill state, or an event stream in [issue #15](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/15).
- Keep content packages versioned so an installed app can identify exactly which published module it cached.
- Do not cache Intake Records for the future PWA unless a later policy decision explicitly permits it. The map currently requires nurse review without browser persistence.
- In [issue #9](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/9), define queue bounds, conflict behavior, sign-out/device cleanup, token expiry while offline, and what remains usable after access is revoked.

These constraints are compatible with every candidate and avoid choosing a NoSQL shadow store prematurely.

## Cost and Operational Validation Needed Later

Published prices change and do not capture district support/procurement requirements. Before selecting a platform, price the same reference workload and environments across candidates:

- One production and one non-production environment.
- Fewer than 100 pilot students and two classes, plus a growth scenario that is not encoded as a product limit.
- OTP/auth monthly active users and production email delivery.
- PostgreSQL compute, storage, backups, PITR, high availability, and restore testing.
- File storage and egress.
- Function/API invocations and translation characters.
- Audit/security log volume and required retention.
- Compliance plan/add-on, support, SSO, and contractual costs where required.

Supabase likely has the smallest number of separately billed/operated components. Firebase SQL Connect has a Cloud SQL baseline plus companion-service usage. AWS has the most dimensions and is the most sensitive to topology and logging choices. These are architecture assessments, not cost quotes.

## Recommendation for Later Decisions

### Carry forward

- **Supabase:** carry into [issue #5](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/5) as the low-operations reference implementation. Require proof of the RLS model, clinical audit events, secret boundaries, restore behavior, plan costs, and contract fit.
- **Firebase SQL Connect:** carry into issue #5 if Firebase/Google Cloud alignment has strategic value. Before treating it as equivalent, resolve whether the alpha can use email links or must fund a custom six-digit OTP service, and obtain an authoritative covered-service/contract answer for the selected Google services.
- **AWS composition:** carry into issue #5 as the high-control comparator. Select it for implementation only if district procurement, service eligibility, network/key controls, existing AWS operations, or another concrete requirement outweighs the added engineering and operational load.

### Feed these existing decision tickets

- [#5 Decide the alpha backend architecture and module boundaries](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/5): choose the candidate and whether clients may access the data service directly or only a domain API.
- [#8 Decide administrative and clinical authorization](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/8): define permissions, tenant context, clinical-read policy, and audit semantics before implementing RLS/CEL/API checks.
- [#9 Set alpha constraints for a future offline student app](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/9): establish the synchronization seam without adding a second database.
- [#10 Decide the intake form and record lifecycle](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/10): settle encryption, minimization, correction, retention, deletion, backup, and nurse-view behavior.
- [#11 Decide student identity, invitations, and sessions](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/11): settle entry-code versus link UX, roster provisioning, shared-device persistence, revocation, timeout, and account enumeration.
- [#12 Decide the managed content, translation, and publishing model](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/12): keep translation provider choice behind a server-side interface and a reviewed publication workflow.
- [#14 Prototype secure nurse review of intake records](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/14): exercise the chosen candidate's strongest authorization boundary and verify no supported export or browser persistence.
- [#15 Decide durable learning progress semantics](https://github.com/DEM1323/Preventive-Care-Literacy-App/issues/15): define the data model and conflict semantics before offline requirements harden.

## Research Limits

- This is documentation research, not a hands-on proof of concept, penetration test, restore drill, legal review, or vendor contract review.
- Vendor documentation and pricing were reviewed on 2026-08-11 and can change.
- No district cloud standard, existing cloud account/team capability, required region, support SLA, log-retention period, or procurement constraint was available.
- The report intentionally leaves the final platform, identity UX, legal classification, offline behavior, progress semantics, and Intake Record lifecycle to their decision tickets.
