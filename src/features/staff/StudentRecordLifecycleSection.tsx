import { useEffect, useState } from 'react';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type CaseType =
  'access' | 'amendment' | 'transfer' | 'disclosure' | 'hold' | 'disposition';

type RequesterKind =
  | 'school_administrator'
  | 'school_nurse'
  | 'legal_custodian'
  | 'student'
  | 'parent_guardian';

type AuthorityKind =
  'school_administrator' | 'school_nurse' | 'legal_custodian';

type ScopePortion =
  | 'identity'
  | 'membership'
  | 'intake'
  | 'learning_progress'
  | 'audit_evidence'
  | 'complete_bundle';

type CaseDecision = 'authorized' | 'denied' | 'withdrawn';
type CaseOutcome = 'completed' | 'cancelled';

type GovernanceStudent = {
  studentId: string;
  presence: 'enrolled' | 'departed';
  accessStatus: 'active' | 'disabled';
  departure: {
    reason: 'transferred' | 'graduated' | 'withdrew';
    effectiveOn: string;
    recordedAt: string;
  } | null;
  cases: {
    caseId: string;
    caseType: CaseType;
    requestCode: string;
    requesterKind: RequesterKind;
    authorityKind: AuthorityKind;
    decision: string;
    outcome: string;
  }[];
  holds: {
    holdId: string;
    source: string;
    status: 'active' | 'released';
  }[];
  amendments: {
    amendmentId: string;
    caseId: string;
    decision: string;
    reasonCode: string;
    requesterStatementPreserved: boolean;
  }[];
  conflictReviews: {
    reviewId: string;
    conflictKind: string;
    status: 'open' | 'resolved';
    outcome: string | null;
    subjectStudentId: string;
    conflictingStudentId: string;
  }[];
  productions: {
    productionId: string;
    caseId: string;
    status: string;
    cleanupStatus: string;
    purpose: string;
  }[];
  destructionEligibility:
    'not_eligible' | 'eligible_after_departure' | 'blocked_by_hold';
};

type Problem = { code?: string };

const requestCodeByType = {
  access: 'lawful_access',
  amendment: 'amendment_challenge',
  transfer: 'transfer',
  disclosure: 'disclosure',
  hold: 'preservation',
  disposition: 'scheduled_destruction',
} as const;

function StudentAccessStepUpFields(props: {
  password: string;
  totp: string;
  onPassword: (value: string) => void;
  onTotp: (value: string) => void;
}) {
  return (
    <>
      <label
        className="grid gap-2 font-bold"
        htmlFor="student-lifecycle-step-up-password"
      >
        Password
        <input
          id="student-lifecycle-step-up-password"
          type="password"
          autoComplete="current-password"
          value={props.password}
          onChange={(event) => props.onPassword(event.target.value)}
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </label>
      <label
        className="grid gap-2 font-bold"
        htmlFor="student-lifecycle-step-up-totp"
      >
        Authenticator code
        <input
          id="student-lifecycle-step-up-totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={props.totp}
          onChange={(event) => props.onTotp(event.target.value)}
          className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </label>
    </>
  );
}

export function StudentRecordLifecycleSection() {
  const [students, setStudents] = useState<GovernanceStudent[] | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [caseType, setCaseType] = useState<CaseType>('access');
  const [requesterKind, setRequesterKind] = useState<RequesterKind>(
    'school_administrator',
  );
  const [authorityKind, setAuthorityKind] = useState<AuthorityKind>(
    'school_administrator',
  );
  const [scopePortion, setScopePortion] =
    useState<ScopePortion>('complete_bundle');
  const [deadlineAt, setDeadlineAt] = useState('2026-09-30T00:00:00.000Z');
  const [decision, setDecision] = useState<CaseDecision>('authorized');
  const [caseOutcome, setCaseOutcome] = useState<CaseOutcome>('completed');
  const [confirm, setConfirm] = useState<
    | { kind: 'open-case' }
    | { kind: 'decide-case'; caseId: string }
    | { kind: 'close-case'; caseId: string }
    | { kind: 'establish-hold' }
    | { kind: 'release-hold'; holdId: string }
    | { kind: 'resolve-amendment'; caseId: string; decision: string }
    | { kind: 'authorize-production'; caseId: string }
    | { kind: 'decide-review'; reviewId: string }
    | undefined
  >();
  const [amendmentReason, setAmendmentReason] = useState<
    | 'factual_inaccuracy'
    | 'identity_dispute'
    | 'intake_inaccuracy'
    | 'requester_statement_only'
    | 'insufficient_evidence'
    | 'outside_authority'
  >('factual_inaccuracy');
  const [challengedFactId, setChallengedFactId] = useState('');
  const [requesterStatement, setRequesterStatement] = useState('');
  const [relatedStudentId, setRelatedStudentId] = useState('');
  const [productionRecipient, setProductionRecipient] = useState('');
  const [reviewOutcome, setReviewOutcome] = useState<
    'keep_distinct' | 'referred_for_amendment'
  >('keep_distinct');

  async function load() {
    const listing = await client.GET(
      '/api/v1/administration/students/records-governance',
    );
    if (listing.response.status === 200 && listing.data) {
      setStudents(listing.data.students);
      if (
        !selectedId ||
        !listing.data.students.some(
          (student) => student.studentId === selectedId,
        )
      ) {
        setSelectedId(listing.data.students[0]?.studentId);
      }
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selected = students?.find(
    (student) => student.studentId === selectedId,
  );

  function clearStepUp() {
    setPassword('');
    setTotp('');
  }

  async function stepUp(): Promise<boolean> {
    setMessage('Confirming both authentication factors...');
    let result;
    try {
      result = await client.POST('/api/v1/auth/staff/step-up', {
        body: { password, totp },
      });
    } catch {
      setBusy(false);
      clearStepUp();
      setMessage(
        'Authentication could not be checked. Retry without losing this form.',
      );
      return false;
    }
    clearStepUp();
    if (result.response.status !== 200) {
      setBusy(false);
      const problem = result.error as Problem | undefined;
      if (problem?.code === 'STEP_UP_REJECTED') {
        setMessage(
          'Password or authenticator code was not accepted. Try both factors again.',
        );
      } else {
        setMessage('Enter a password and six-digit authenticator code.');
      }
      return false;
    }
    return true;
  }

  async function confirmAction() {
    if (!selected || !confirm) return;
    setBusy(true);
    setMessage('');
    if (!(await stepUp())) return;
    const operationId = crypto.randomUUID();
    if (confirm.kind === 'open-case') {
      const requestCode = requestCodeByType[caseType];
      const result = await client.POST(
        '/api/v1/administration/students/record-lifecycle-cases',
        {
          body: {
            operationId,
            studentId: selected.studentId,
            caseType,
            requestCode,
            requesterKind,
            authorityKind,
            scope: {
              portions: [scopePortion],
              purpose: requestCode,
            },
            deadlineAt,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Lifecycle Case could not be opened.');
        return;
      }
      setMessage(
        'Record Lifecycle Case opened. Access and amendment cases place a Record Hold that blocks destruction only.',
      );
    } else if (confirm.kind === 'decide-case') {
      const result = await client.POST(
        '/api/v1/administration/students/record-lifecycle-case-decisions',
        {
          body: {
            operationId,
            caseId: confirm.caseId,
            decision,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Lifecycle Case decision could not be recorded.');
        return;
      }
      setMessage('Record Lifecycle Case decision recorded.');
    } else if (confirm.kind === 'close-case') {
      const result = await client.POST(
        '/api/v1/administration/students/record-lifecycle-case-outcomes',
        {
          body: {
            operationId,
            caseId: confirm.caseId,
            outcome: caseOutcome,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Lifecycle Case outcome could not be recorded.');
        return;
      }
      setMessage(
        'Record Lifecycle Case outcome recorded. Automatic Record Holds for this case are released.',
      );
    } else if (confirm.kind === 'establish-hold') {
      const result = await client.POST(
        '/api/v1/administration/students/record-holds',
        {
          body: {
            operationId,
            studentId: selected.studentId,
            reason: 'school_preservation',
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Hold could not be established.');
        return;
      }
      setMessage(
        'Record Hold established. Destruction is blocked. Authorized access, amendment, transfer, and disclosure can continue.',
      );
    } else if (confirm.kind === 'release-hold') {
      const result = await client.POST(
        '/api/v1/administration/students/record-hold-releases',
        {
          body: { operationId, holdId: confirm.holdId },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Hold could not be released.');
        return;
      }
      setMessage('Record Hold released.');
    } else if (confirm.kind === 'resolve-amendment') {
      const decision =
        confirm.decision === 'denied'
          ? 'challenge_denied'
          : 'correction_authorized';
      const result = await client.POST(
        '/api/v1/administration/students/record-amendments',
        {
          body: {
            operationId,
            caseId: confirm.caseId,
            challengedFactKind: scopePortion === 'intake' ? 'intake_record_version' : 'identity',
            challengedFactId: challengedFactId || selected.studentId,
            decision,
            reasonCode: amendmentReason,
            ...(decision === 'correction_authorized'
              ? {
                  effectiveCorrection: {
                    projectionKind:
                      scopePortion === 'intake'
                        ? 'intake_record_version'
                        : 'identity',
                    summaryCode: amendmentReason,
                    challengedFactId: challengedFactId || selected.studentId,
                  },
                }
              : {}),
            ...(requesterStatement.trim()
              ? { requesterStatement: requesterStatement.trim() }
              : {}),
            ...(relatedStudentId.trim()
              ? { relatedStudentId: relatedStudentId.trim() }
              : {}),
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      setRequesterStatement('');
      setRelatedStudentId('');
      if (result.response.status === 409) {
        const problem = result.error as Problem & { reviewId?: string };
        if (problem?.code === 'RECORD_CONFLICT_REVIEW_REQUIRED') {
          setMessage(
            'Conflicting records entered Record Conflict Review. Identities were not merged.',
          );
          await load();
          return;
        }
        setMessage('The Record Amendment could not be recorded.');
        return;
      }
      if (result.response.status !== 200) {
        setMessage('The Record Amendment could not be recorded.');
        return;
      }
      setMessage(
        'Record Amendment recorded. The original fact and evidence remain.',
      );
    } else if (confirm.kind === 'authorize-production') {
      const result = await client.POST(
        '/api/v1/administration/students/record-productions',
        {
          body: {
            operationId,
            caseId: confirm.caseId,
            recipient: productionRecipient,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      setProductionRecipient('');
      if (result.response.status !== 200) {
        setMessage('The Record Production could not be authorized.');
        return;
      }
      setMessage(
        'Record Production authorized. The package is delivered through the one-recipient channel only.',
      );
    } else {
      const result = await client.POST(
        '/api/v1/administration/students/record-conflict-review-decisions',
        {
          body: {
            operationId,
            reviewId: confirm.reviewId,
            outcome: reviewOutcome,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Record Conflict Review could not be resolved.');
        return;
      }
      setMessage(
        'Record Conflict Review resolved. Students remain distinct; there is no merge.',
      );
    }
    await load();
  }

  if (!students) {
    return (
      <section className="mt-10 border-t border-slate-700 pt-8">
        <p className="text-slate-400">Loading Student Record Lifecycle…</p>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-slate-700 pt-8">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-sky-300">
        Records governance
      </p>
      <h2 className="mt-2 text-xl font-black tracking-tight">
        Student Record Lifecycle
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Administrators record Student Departure, Record Lifecycle Cases, and
        Record Holds. This view does not include Intake answers, Intake Drafts,
        Learning Progress, or generated clinical content.
      </p>
      {students.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No Students yet.</p>
      ) : (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2 font-bold" htmlFor="lifecycle-student">
            Student
            <select
              id="lifecycle-student"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
            >
              {students.map((student) => (
                <option key={student.studentId} value={student.studentId}>
                  {student.presence} · {student.destructionEligibility} ·{' '}
                  {student.studentId.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {selected ? (
            <div className="grid gap-3 text-sm text-slate-300">
              <p>
                Presence {selected.presence} · Access {selected.accessStatus} ·
                Destruction{' '}
                {selected.destructionEligibility.replaceAll('_', ' ')}
              </p>
              {selected.departure ? (
                <p>
                  Student Departure {selected.departure.reason} effective{' '}
                  {selected.departure.effectiveOn}
                </p>
              ) : null}
              <p>blocked_by_hold means destruction cannot proceed.</p>
              <ul className="grid gap-1 text-xs text-slate-400">
                {selected.cases.map((item) => (
                  <li key={item.caseId}>
                    Record Lifecycle Case {item.caseType} · {item.requestCode} ·{' '}
                    {item.requesterKind} · {item.authorityKind} ·{' '}
                    {item.decision} · {item.outcome}
                    {item.outcome === 'open' ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="font-bold text-sky-300"
                          onClick={() =>
                            setConfirm({
                              kind: 'decide-case',
                              caseId: item.caseId,
                            })
                          }
                        >
                          Record Lifecycle Case Decision
                        </button>
                        {item.decision !== 'pending' ? (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="font-bold text-sky-300"
                              onClick={() =>
                                setConfirm({
                                  kind: 'close-case',
                                  caseId: item.caseId,
                                })
                              }
                            >
                              Record Lifecycle Case Outcome
                            </button>
                          </>
                        ) : null}
                        {item.caseType === 'amendment' &&
                        item.decision !== 'pending' ? (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="font-bold text-sky-300"
                              onClick={() =>
                                setConfirm({
                                  kind: 'resolve-amendment',
                                  caseId: item.caseId,
                                  decision: item.decision,
                                })
                              }
                            >
                              Resolve Record Amendment
                            </button>
                          </>
                        ) : null}
                        {(item.caseType === 'access' ||
                          item.caseType === 'transfer' ||
                          item.caseType === 'disclosure') &&
                        item.decision === 'authorized' ? (
                          <>
                            {' '}
                            <button
                              type="button"
                              className="font-bold text-sky-300"
                              onClick={() =>
                                setConfirm({
                                  kind: 'authorize-production',
                                  caseId: item.caseId,
                                })
                              }
                            >
                              Authorize Record Production
                            </button>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </li>
                ))}
                {selected.holds.map((item) => (
                  <li key={item.holdId}>
                    Record Hold {item.source} · {item.status}
                    {item.status === 'active' && item.source === 'manual' ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="font-bold text-sky-300"
                          onClick={() =>
                            setConfirm({
                              kind: 'release-hold',
                              holdId: item.holdId,
                            })
                          }
                        >
                          Release Record Hold
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
                {selected.amendments.map((item) => (
                  <li key={item.amendmentId}>
                    Record Amendment {item.decision} · {item.reasonCode}
                    {item.requesterStatementPreserved
                      ? ' · requester statement preserved'
                      : ''}
                  </li>
                ))}
                {selected.conflictReviews.map((item) => (
                  <li key={item.reviewId}>
                    Record Conflict Review {item.conflictKind} · {item.status}
                    {item.outcome ? ` · ${item.outcome}` : ''}
                    {item.status === 'open' ? (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="font-bold text-sky-300"
                          onClick={() =>
                            setConfirm({
                              kind: 'decide-review',
                              reviewId: item.reviewId,
                            })
                          }
                        >
                          Record Conflict Review
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
                {selected.productions.map((item) => (
                  <li key={item.productionId}>
                    Record Production {item.purpose} · {item.status} · cleanup{' '}
                    {item.cleanupStatus}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-xs font-bold text-sky-300"
                  onClick={() => setConfirm({ kind: 'open-case' })}
                >
                  Open Record Lifecycle Case
                </button>
                <button
                  type="button"
                  className="text-xs font-bold text-sky-300"
                  onClick={() => setConfirm({ kind: 'establish-hold' })}
                >
                  Establish Record Hold
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <p aria-live="polite" className="mt-4 text-sm text-slate-300">
        {message}
      </p>
      {confirm ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/80 p-4">
          <section className="w-full max-w-lg border-l-4 border-amber-400 bg-slate-900 p-6 text-slate-100">
            <h3 className="text-xl font-black tracking-tight">
              {confirm.kind === 'open-case'
                ? 'Open Record Lifecycle Case'
                : confirm.kind === 'decide-case'
                  ? 'Record Lifecycle Case Decision'
                  : confirm.kind === 'close-case'
                    ? 'Record Lifecycle Case Outcome'
                    : confirm.kind === 'establish-hold'
                      ? 'Establish Record Hold'
                      : confirm.kind === 'resolve-amendment'
                        ? 'Resolve Record Amendment'
                        : confirm.kind === 'authorize-production'
                          ? 'Authorize Record Production'
                          : confirm.kind === 'decide-review'
                            ? 'Record Conflict Review'
                            : 'Release Record Hold'}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {confirm.kind === 'open-case'
                ? 'This records a formal request, requester, authority, scope, and deadline. Access and amendment cases automatically establish a Record Hold that blocks destruction only. Protected record contents are not shown here.'
                : confirm.kind === 'decide-case'
                  ? 'This records the decision on this Record Lifecycle Case. It does not deliver records or apply an amendment.'
                  : confirm.kind === 'close-case'
                    ? 'This records the outcome and closes the Record Lifecycle Case. Automatic Record Holds for this case are released. This does not destroy records.'
                    : confirm.kind === 'establish-hold'
                      ? 'This Record Hold blocks destruction. It does not deny separately authorized access, amendment, transfer, or disclosure.'
                      : confirm.kind === 'resolve-amendment'
                        ? 'This records an append-only Record Amendment. The original fact stays. Conflicting identities enter Record Conflict Review instead of merge.'
                        : confirm.kind === 'authorize-production'
                          ? 'This authorizes a purpose-scoped Record Production from the case. The package is not shown here and is delivered only through the one-recipient channel.'
                          : confirm.kind === 'decide-review'
                            ? 'This records a non-merge outcome. Students remain distinct. There is no Administrator merge action.'
                            : 'Releasing this Record Hold may make destruction eligible if no other Record Hold remains. This does not restore Student access.'}
            </p>
            {confirm.kind === 'open-case' ? (
              <div className="mt-4 grid gap-3">
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="lifecycle-case-type"
                >
                  Record Lifecycle Case type
                  <select
                    id="lifecycle-case-type"
                    value={caseType}
                    onChange={(event) =>
                      setCaseType(event.target.value as CaseType)
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  >
                    <option value="access">access</option>
                    <option value="amendment">amendment</option>
                    <option value="transfer">transfer</option>
                    <option value="disclosure">disclosure</option>
                    <option value="hold">hold</option>
                    <option value="disposition">disposition</option>
                  </select>
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="lifecycle-case-requester"
                >
                  Requester
                  <select
                    id="lifecycle-case-requester"
                    value={requesterKind}
                    onChange={(event) =>
                      setRequesterKind(event.target.value as RequesterKind)
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  >
                    <option value="school_administrator">
                      school administrator
                    </option>
                    <option value="school_nurse">school nurse</option>
                    <option value="legal_custodian">legal custodian</option>
                    <option value="student">student</option>
                    <option value="parent_guardian">parent or guardian</option>
                  </select>
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="lifecycle-case-authority"
                >
                  Authority
                  <select
                    id="lifecycle-case-authority"
                    value={authorityKind}
                    onChange={(event) =>
                      setAuthorityKind(event.target.value as AuthorityKind)
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  >
                    <option value="school_administrator">
                      school administrator
                    </option>
                    <option value="school_nurse">school nurse</option>
                    <option value="legal_custodian">legal custodian</option>
                  </select>
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="lifecycle-case-scope"
                >
                  Scope
                  <select
                    id="lifecycle-case-scope"
                    value={scopePortion}
                    onChange={(event) =>
                      setScopePortion(event.target.value as ScopePortion)
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  >
                    <option value="complete_bundle">complete bundle</option>
                    <option value="identity">identity</option>
                    <option value="membership">membership</option>
                    <option value="intake">intake metadata</option>
                    <option value="learning_progress">
                      learning progress metadata
                    </option>
                    <option value="audit_evidence">audit evidence</option>
                  </select>
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="lifecycle-case-deadline"
                >
                  Deadline
                  <input
                    id="lifecycle-case-deadline"
                    type="text"
                    value={deadlineAt}
                    onChange={(event) => setDeadlineAt(event.target.value)}
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  />
                </label>
              </div>
            ) : null}
            {confirm.kind === 'decide-case' ? (
              <label
                className="mt-4 grid gap-2 font-bold"
                htmlFor="lifecycle-case-decision"
              >
                Decision
                <select
                  id="lifecycle-case-decision"
                  value={decision}
                  onChange={(event) =>
                    setDecision(event.target.value as CaseDecision)
                  }
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                >
                  <option value="authorized">authorized</option>
                  <option value="denied">denied</option>
                  <option value="withdrawn">withdrawn</option>
                </select>
              </label>
            ) : null}
            {confirm.kind === 'close-case' ? (
              <label
                className="mt-4 grid gap-2 font-bold"
                htmlFor="lifecycle-case-outcome"
              >
                Outcome
                <select
                  id="lifecycle-case-outcome"
                  value={caseOutcome}
                  onChange={(event) =>
                    setCaseOutcome(event.target.value as CaseOutcome)
                  }
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                >
                  <option value="completed">completed</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </label>
            ) : null}
            {confirm.kind === 'resolve-amendment' ? (
              <div className="mt-4 grid gap-3">
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="amendment-reason"
                >
                  Reason
                  <select
                    id="amendment-reason"
                    value={amendmentReason}
                    onChange={(event) =>
                      setAmendmentReason(
                        event.target.value as typeof amendmentReason,
                      )
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  >
                    <option value="factual_inaccuracy">factual inaccuracy</option>
                    <option value="identity_dispute">identity dispute</option>
                    <option value="intake_inaccuracy">intake inaccuracy</option>
                    <option value="requester_statement_only">
                      requester statement only
                    </option>
                    <option value="insufficient_evidence">
                      insufficient evidence
                    </option>
                    <option value="outside_authority">outside authority</option>
                  </select>
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="amendment-fact-id"
                >
                  Challenged fact
                  <input
                    id="amendment-fact-id"
                    type="text"
                    value={challengedFactId}
                    onChange={(event) => setChallengedFactId(event.target.value)}
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  />
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="amendment-statement"
                >
                  Requester statement
                  <textarea
                    id="amendment-statement"
                    value={requesterStatement}
                    onChange={(event) =>
                      setRequesterStatement(event.target.value)
                    }
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  />
                </label>
                <label
                  className="grid gap-2 font-bold"
                  htmlFor="amendment-related-student"
                >
                  Related Student
                  <input
                    id="amendment-related-student"
                    type="text"
                    value={relatedStudentId}
                    onChange={(event) => setRelatedStudentId(event.target.value)}
                    className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                  />
                </label>
              </div>
            ) : null}
            {confirm.kind === 'authorize-production' ? (
              <label
                className="mt-4 grid gap-2 font-bold"
                htmlFor="production-recipient"
              >
                Recipient
                <input
                  id="production-recipient"
                  type="email"
                  value={productionRecipient}
                  onChange={(event) =>
                    setProductionRecipient(event.target.value)
                  }
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                />
              </label>
            ) : null}
            {confirm.kind === 'decide-review' ? (
              <label
                className="mt-4 grid gap-2 font-bold"
                htmlFor="conflict-review-outcome"
              >
                Outcome
                <select
                  id="conflict-review-outcome"
                  value={reviewOutcome}
                  onChange={(event) =>
                    setReviewOutcome(
                      event.target.value as typeof reviewOutcome,
                    )
                  }
                  className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal"
                >
                  <option value="keep_distinct">keep distinct</option>
                  <option value="referred_for_amendment">
                    referred for amendment
                  </option>
                </select>
              </label>
            ) : null}
            <div className="mt-4 grid gap-3">
              <StudentAccessStepUpFields
                password={password}
                totp={totp}
                onPassword={setPassword}
                onTotp={setTotp}
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmAction()}
                className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
              >
                {confirm.kind === 'open-case'
                  ? 'Open Record Lifecycle Case'
                  : confirm.kind === 'decide-case'
                    ? 'Record Lifecycle Case Decision'
                    : confirm.kind === 'close-case'
                      ? 'Record Lifecycle Case Outcome'
                      : confirm.kind === 'establish-hold'
                        ? 'Establish Record Hold'
                        : confirm.kind === 'resolve-amendment'
                          ? 'Resolve Record Amendment'
                          : confirm.kind === 'authorize-production'
                            ? 'Authorize Record Production'
                            : confirm.kind === 'decide-review'
                              ? 'Record Conflict Review'
                              : 'Release Record Hold'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirm(undefined);
                  clearStepUp();
                }}
                className="rounded border border-slate-600 px-4 py-2 font-bold disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
