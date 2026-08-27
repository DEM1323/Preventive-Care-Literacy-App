import { useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createBrowserApiClient } from '../../../packages/api-client/src/index.ts';

const client = createBrowserApiClient();

type InvitationStatus =
  | 'pending_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'expired'
  | 'completed'
  | 'revoked'
  | 'superseded';

export type ClassDirectoryEntry = {
  classId: string;
  name: string;
  createdAt: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  invitations: {
    invitationId: string;
    purpose: 'join_class';
    generation: number;
    status: InvitationStatus;
    expiresAt: string;
  }[];
  relationships: {
    recipient: string;
    studentId: string | null;
    classMembershipId: string | null;
    membershipStatus: 'none' | 'active' | 'inactive';
    latestInvitation: {
      invitationId: string;
      purpose: 'join_class';
      generation: number;
      status: InvitationStatus;
      expiresAt: string;
    };
    deliveryStatus: 'delivered' | 'delayed' | 'failed';
    history: {
      invitationId: string;
      status: InvitationStatus;
      generation: number;
      createdAt: string;
    }[];
  }[];
};

type InvitationPreview =
  | { outcome: 'ready'; reuse: 'none' | 'existing_student' | 'inactive_membership' }
  | { outcome: 'already_a_member' }
  | { outcome: 'already_invited' }
  | { outcome: 'identity_review'; reason: 'historical_binding' }
  | { outcome: 'class_closed' };

type CsvPreviewRow =
  | {
      lineNumber: number;
      field: string;
      outcome: 'ready';
      reuse: 'none' | 'existing_student' | 'inactive_membership';
    }
  | { lineNumber: number; field: string; outcome: 'malformed' }
  | { lineNumber: number; field: string; outcome: 'duplicate_in_file' }
  | { lineNumber: number; field: string; outcome: 'already_a_member' }
  | { lineNumber: number; field: string; outcome: 'already_invited' }
  | {
      lineNumber: number;
      field: string;
      outcome: 'identity_review';
      reason: 'historical_binding';
    }
  | { lineNumber: number; field: string; outcome: 'class_closed' };

type Problem = { code?: string; reason?: string };

type ConfirmKind = 'revoke' | 'deactivate' | 'close';

const invitationCsvMaxBytes = 32 * 1024;

function previewMessage(preview: InvitationPreview): string {
  if (preview.outcome === 'ready' && preview.reuse === 'none') {
    return 'Ready to send. New email address.';
  }
  if (preview.outcome === 'ready' && preview.reuse === 'existing_student') {
    return 'Ready to send. Existing Student will be reused for this Class.';
  }
  if (preview.outcome === 'ready' && preview.reuse === 'inactive_membership') {
    return 'Ready to send. A fresh Invitation will reactivate this Class Membership.';
  }
  if (preview.outcome === 'already_a_member') {
    return 'Already a member. Active in this Class.';
  }
  if (preview.outcome === 'already_invited') {
    return 'Already invited. Pending in this Class.';
  }
  if (preview.outcome === 'identity_review') {
    return 'Blocked for identity review. Historical email binding needs staff remediation.';
  }
  return 'This Class is closed.';
}

function csvRowMessage(row: CsvPreviewRow): string {
  if (row.outcome === 'ready' && row.reuse === 'none') {
    return 'Ready to send. New email address.';
  }
  if (row.outcome === 'ready' && row.reuse === 'existing_student') {
    return 'Ready to send. Existing Student will be reused for this Class.';
  }
  if (row.outcome === 'ready' && row.reuse === 'inactive_membership') {
    return 'Ready to send. A fresh Invitation will reactivate this Class Membership.';
  }
  if (row.outcome === 'malformed') {
    return 'Malformed. Not an email address.';
  }
  if (row.outcome === 'duplicate_in_file') {
    return 'Duplicate in file. This address already appears above.';
  }
  if (row.outcome === 'already_a_member') {
    return 'Already a member. Active in this Class.';
  }
  if (row.outcome === 'already_invited') {
    return 'Already invited. Pending in this Class.';
  }
  if (row.outcome === 'identity_review') {
    return 'Blocked for identity review. Historical email binding needs staff remediation.';
  }
  return 'This Class is closed.';
}

function csvRejectionMessage(reason: string | undefined): string {
  if (reason === 'too_many_rows') {
    return 'This CSV has too many rows. Use at most 500 rows.';
  }
  if (reason === 'empty') {
    return 'This CSV does not contain any Invitation rows.';
  }
  return 'This CSV is too large. Use at most 500 rows and 32 KB.';
}

const RESENDABLE_STATUSES: InvitationStatus[] = [
  'pending_delivery',
  'delivered',
  'expired',
  'delivery_failed',
];

function needsFollowUp(row: ClassDirectoryEntry['relationships'][number]) {
  return row.membershipStatus !== 'active';
}

function lastTransitionLabel(
  row: ClassDirectoryEntry['relationships'][number],
): string {
  const latestHistory = row.history[row.history.length - 1];
  const when = latestHistory?.createdAt ?? row.latestInvitation.expiresAt;
  if (
    row.latestInvitation.status === 'pending_delivery' ||
    row.latestInvitation.status === 'delivered'
  ) {
    return `Expires ${row.latestInvitation.expiresAt}`;
  }
  return `${row.latestInvitation.status.replaceAll('_', ' ')} ${when}`;
}

function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-confirm-title"
        className="w-full max-w-lg border border-slate-700 bg-slate-900 p-6"
      >
        <h3 id="class-confirm-title" className="text-xl font-black">
          {props.title}
        </h3>
        <p className="mt-3 text-sm text-slate-300">{props.body}</p>
        {props.children}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onConfirm}
            className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {props.confirmLabel}
          </button>
          <button
            type="button"
            disabled={props.busy}
            onClick={props.onCancel}
            className="rounded border border-slate-600 px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export function ClassWorkspace(props: {
  classes: ClassDirectoryEntry[];
  onReload: () => Promise<void>;
}) {
  const openClasses = props.classes.filter((entry) => entry.status === 'open');
  const closedClasses = props.classes.filter(
    (entry) => entry.status === 'closed',
  );
  const [selectedClassId, setSelectedClassId] = useState(openClasses[0]?.classId);
  const [historyClassId, setHistoryClassId] = useState<string | undefined>();
  const selected =
    openClasses.find((entry) => entry.classId === selectedClassId) ??
    openClasses[0];
  const historyClass = closedClasses.find(
    (entry) => entry.classId === historyClassId,
  );
  const [className, setClassName] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tab, setTab] = useState<'follow-up' | 'active'>('follow-up');
  const [preview, setPreview] = useState<InvitationPreview | undefined>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<
    | { kind: ConfirmKind; invitationId?: string; classMembershipId?: string }
    | undefined
  >();
  const [emptyChoice, setEmptyChoice] = useState<'email' | 'csv' | undefined>();
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState<CsvPreviewRow[]>([]);
  const [csvSummary, setCsvSummary] = useState<
    { ready: number; skipped: number } | undefined
  >();
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [csvConfirmOpen, setCsvConfirmOpen] = useState(false);
  const [csvOperationId, setCsvOperationId] = useState('');
  const [csvPassword, setCsvPassword] = useState('');
  const [csvTotp, setCsvTotp] = useState('');

  const followUp = useMemo(
    () => selected?.relationships.filter(needsFollowUp) ?? [],
    [selected],
  );
  const active = useMemo(
    () =>
      selected?.relationships.filter(
        (row) => row.membershipStatus === 'active',
      ) ?? [],
    [selected],
  );
  const rows = tab === 'active' ? active : followUp;
  const canInvite = Boolean(selected);
  const isEmptyClass = Boolean(selected && selected.relationships.length === 0);

  function resetCsv() {
    setCsvText('');
    setCsvRows([]);
    setCsvSummary(undefined);
    setSelectedLines([]);
    setCsvConfirmOpen(false);
    setCsvOperationId('');
    setCsvPassword('');
    setCsvTotp('');
  }

  async function createClass(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const result = await client.POST(
      '/api/v1/administration/classes/definitions',
      {
        body: {
          operationId: crypto.randomUUID(),
          classId: crypto.randomUUID(),
          name: className,
        },
      },
    );
    setBusy(false);
    if (result.response.status !== 201 || !result.data) {
      setMessage('The Class could not be created.');
      return;
    }
    setClassName('');
    setSelectedClassId(result.data.classId);
    setEmptyChoice(undefined);
    setCsvOpen(false);
    resetCsv();
    setMessage(
      'Empty Class created. Choose adding one email address or importing a CSV.',
    );
    await props.onReload();
  }

  async function previewInvitation(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage('');
    const result = await client.POST(
      '/api/v1/administration/classes/invitation-previews',
      { body: { classId: selected.classId, recipient } },
    );
    setBusy(false);
    if (result.response.status !== 200 || !result.data) {
      setMessage('The Invitation could not be checked.');
      return;
    }
    setPreview(result.data);
  }

  async function sendInvitation() {
    if (!selected || !preview || preview.outcome !== 'ready') return;
    setBusy(true);
    const result = await client.POST(
      '/api/v1/administration/classes/invitations',
      {
        body: {
          operationId: crypto.randomUUID(),
          classId: selected.classId,
          invitationId: crypto.randomUUID(),
          recipient,
        },
      },
    );
    setBusy(false);
    if (result.response.status !== 201) {
      setMessage('The Invitation could not be sent.');
      return;
    }
    setRecipient('');
    setPreview(undefined);
    setMessage('Invitation sent. Delivery is pending.');
    await props.onReload();
  }

  async function previewCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!selected || !file) return;
    if (file.size > invitationCsvMaxBytes) {
      resetCsv();
      setMessage(csvRejectionMessage('too_large'));
      return;
    }
    setBusy(true);
    setMessage('');
    const csv = await file.text();
    const result = await client.POST(
      '/api/v1/administration/classes/invitation-csv-previews',
      { body: { classId: selected.classId, csv } },
    );
    setBusy(false);
    if (result.response.status === 422) {
      resetCsv();
      setMessage(
        csvRejectionMessage((result.error as Problem | undefined)?.reason),
      );
      return;
    }
    if (result.response.status !== 200 || !result.data) {
      resetCsv();
      setMessage('The CSV could not be checked.');
      return;
    }
    setCsvText(csv);
    setCsvRows(result.data.rows);
    setCsvSummary(result.data.summary);
    setSelectedLines(
      result.data.rows
        .filter((row) => row.outcome === 'ready')
        .map((row) => row.lineNumber),
    );
    setMessage(
      `Preview ready. ${result.data.summary.ready} ready to send · ${result.data.summary.skipped} skipped. Nothing has been sent.`,
    );
  }

  function toggleCsvRow(lineNumber: number, ready: boolean) {
    if (!ready) return;
    setSelectedLines((current) =>
      current.includes(lineNumber)
        ? current.filter((line) => line !== lineNumber)
        : [...current, lineNumber],
    );
  }

  async function sendCsvInvitations() {
    if (!selected || csvRows.length === 0 || busy) return;
    const operationId = csvOperationId || crypto.randomUUID();
    if (!csvOperationId) setCsvOperationId(operationId);
    setBusy(true);
    setMessage('Confirming both authentication factors...');
    let stepUp;
    try {
      stepUp = await client.POST('/api/v1/auth/staff/step-up', {
        body: { password: csvPassword, totp: csvTotp },
      });
    } catch {
      setBusy(false);
      setCsvPassword('');
      setCsvTotp('');
      setMessage(
        'Authentication could not be checked. Retry without losing this preview.',
      );
      return;
    }
    setCsvPassword('');
    setCsvTotp('');
    if (stepUp.response.status !== 200) {
      setBusy(false);
      const problem = stepUp.error as Problem | undefined;
      if (problem?.code === 'STEP_UP_REJECTED') {
        setMessage(
          'Password or authenticator code was not accepted. Try both factors again.',
        );
      } else if (problem?.code === 'STEP_UP_INCOMPLETE') {
        setMessage('Enter a password and six-digit authenticator code.');
      } else {
        setMessage(
          'Authentication could not be checked. Retry without losing this preview.',
        );
      }
      return;
    }
    const result = await client.POST(
      '/api/v1/administration/classes/invitation-csv-sends',
      {
        body: {
          operationId,
          classId: selected.classId,
          csv: csvText,
          selectedLineNumbers: selectedLines,
        },
      },
    );
    setBusy(false);
    if (result.response.status === 409) {
      const problem = result.error as Problem | undefined;
      if (problem?.code === 'AUTHENTICATION_FRESHNESS_REQUIRED') {
        setMessage(
          'Authentication freshness expired. Confirm both factors again; this preview is preserved.',
        );
        return;
      }
    }
    if (result.response.status !== 201 || !result.data) {
      setMessage('The approved Invitations could not be sent.');
      return;
    }
    setCsvConfirmOpen(false);
    setCsvOpen(false);
    resetCsv();
    setEmptyChoice(undefined);
    setMessage(
      `Sent ${result.data.summary.sent} Invitations. ${result.data.summary.skipped} skipped. Delivery is pending.`,
    );
    await props.onReload();
  }

  async function resend(invitationId: string) {
    setBusy(true);
    const result = await client.POST(
      '/api/v1/administration/classes/invitation-resends',
      {
        body: {
          operationId: crypto.randomUUID(),
          invitationId,
          replacementInvitationId: crypto.randomUUID(),
        },
      },
    );
    setBusy(false);
    if (result.response.status !== 201) {
      setMessage('The replacement Invitation could not be sent.');
      return;
    }
    setMessage('Replacement Invitation sent. The prior Invitation is superseded.');
    await props.onReload();
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    if (confirm.kind === 'revoke' && confirm.invitationId) {
      const result = await client.POST(
        '/api/v1/administration/classes/invitation-revocations',
        {
          body: {
            operationId: crypto.randomUUID(),
            invitationId: confirm.invitationId,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Invitation could not be revoked.');
        return;
      }
      setMessage('Invitation revoked.');
    } else if (confirm.kind === 'deactivate' && confirm.classMembershipId) {
      const result = await client.POST(
        '/api/v1/administration/classes/membership-deactivations',
        {
          body: {
            operationId: crypto.randomUUID(),
            classMembershipId: confirm.classMembershipId,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Class Membership could not be deactivated.');
        return;
      }
      setMessage('Class Membership deactivated.');
    } else if (confirm.kind === 'close' && selected) {
      const result = await client.POST(
        '/api/v1/administration/classes/closures',
        {
          body: {
            operationId: crypto.randomUUID(),
            classId: selected.classId,
          },
        },
      );
      setBusy(false);
      setConfirm(undefined);
      if (result.response.status !== 200) {
        setMessage('The Class could not be closed.');
        return;
      }
      setMessage('Class closed. History is preserved in the read-only list.');
      setHistoryClassId(selected.classId);
    } else {
      setBusy(false);
      setConfirm(undefined);
    }
    await props.onReload();
  }

  return (
    <div className="mt-10 border-t border-slate-700 pt-8">
      <p className="text-sm font-black uppercase tracking-[0.24em] text-sky-300">
        Class access group
      </p>
      <h2 className="mt-2 text-xl font-black tracking-tight">Classes</h2>
      <p className="mt-2 text-sm text-slate-400">
        A Class groups Invitations and access. It is not a course and has no
        grades, assignments, attendance, or messaging.
      </p>

      <form className="mt-6 grid gap-4" onSubmit={createClass}>
        <label className="grid gap-2 font-bold" htmlFor="class-name">
          Class name
          <input
            id="class-name"
            required
            maxLength={200}
            value={className}
            onChange={(event) => setClassName(event.target.value)}
            className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
        >
          Create empty Class
        </button>
      </form>

      <form className="mt-6 grid gap-4" onSubmit={previewInvitation}>
        <label className="grid gap-2 font-bold" htmlFor="invitation-recipient">
          Invitation email
          <input
            id="invitation-recipient"
            required
            type="email"
            maxLength={320}
            disabled={!canInvite}
            value={recipient}
            onChange={(event) => {
              setRecipient(event.target.value);
              setPreview(undefined);
            }}
            className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !canInvite}
          className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
        >
          Check before sending
        </button>
      </form>

      {preview ? (
        <div className="mt-4 border border-slate-700 bg-slate-950 p-4">
          <p className="font-bold">{previewMessage(preview)}</p>
          {preview.outcome === 'ready' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendInvitation()}
              className="mt-3 rounded bg-emerald-400 px-4 py-2 font-black text-slate-950 disabled:opacity-50"
            >
              Send Invitation
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Open Classes
          </p>
          <div className="mt-3 grid gap-2">
            {openClasses.map((entry) => (
              <button
                key={entry.classId}
                type="button"
                onClick={() => {
                  setSelectedClassId(entry.classId);
                  setPreview(undefined);
                  setTab('follow-up');
                  setEmptyChoice(undefined);
                  setCsvOpen(false);
                  resetCsv();
                }}
                className={`rounded border p-3 text-left ${
                  entry.classId === selected?.classId
                    ? 'border-sky-400 bg-slate-950'
                    : 'border-slate-700'
                }`}
              >
                <span className="block font-black">{entry.name}</span>
                <span className="mt-1 block text-xs text-slate-400">
                  {entry.relationships.length} Students
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div>
          {selected ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-black">{selected.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Invitation and access group
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {!isEmptyClass || emptyChoice === 'csv' || csvOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCsvOpen(true);
                        setEmptyChoice('csv');
                      }}
                      className="rounded border border-slate-600 px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Import CSV
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setConfirm({ kind: 'close' })}
                    className="rounded border border-rose-400 px-3 py-2 text-sm font-bold text-rose-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Close Class
                  </button>
                </div>
              </div>

              {csvOpen || emptyChoice === 'csv' ? (
                <section className="mt-6 border border-slate-700 bg-slate-950 p-4">
                  <h4 className="font-black">Preview CSV import</h4>
                  <p className="mt-1 text-sm text-slate-400">
                    Nothing is sent until you select ready rows and confirm with
                    password and authenticator.
                  </p>
                  <label
                    className="mt-4 grid gap-2 font-bold"
                    htmlFor="invitation-csv-file"
                  >
                    Invitation CSV
                    <input
                      id="invitation-csv-file"
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy}
                      onChange={(event) => void previewCsvFile(event)}
                      className="font-normal file:mr-3 file:rounded file:border-0 file:bg-sky-400 file:px-3 file:py-2 file:font-black file:text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                  </label>
                  {csvSummary ? (
                    <div className="mt-4">
                      <p className="text-sm font-bold">
                        {csvSummary.ready} ready to send · {csvSummary.skipped}{' '}
                        skipped
                      </p>
                      <div className="mt-3 divide-y divide-slate-800 border border-slate-700">
                        {csvRows.map((row) => {
                          const ready = row.outcome === 'ready';
                          const checkboxId = `csv-row-${row.lineNumber}`;
                          return (
                            <div
                              key={row.lineNumber}
                              className="grid gap-2 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                            >
                              <input
                                id={checkboxId}
                                type="checkbox"
                                disabled={!ready || busy}
                                checked={selectedLines.includes(row.lineNumber)}
                                onChange={() =>
                                  toggleCsvRow(row.lineNumber, ready)
                                }
                                className="h-4 w-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                              />
                              <label htmlFor={checkboxId} className="min-w-0">
                                <span className="block truncate font-bold">
                                  {row.field || '(empty)'}
                                </span>
                                <span className="block text-xs text-slate-400">
                                  {csvRowMessage(row)}
                                </span>
                              </label>
                              <span className="w-fit rounded px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-200">
                                {row.outcome.replaceAll('_', ' ')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={busy || selectedLines.length === 0}
                        onClick={() => {
                          setCsvOperationId(crypto.randomUUID());
                          setCsvConfirmOpen(true);
                        }}
                        className="mt-4 rounded bg-emerald-400 px-4 py-2 font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                      >
                        Continue with {selectedLines.length} valid rows
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selected.relationships.length > 0 ? (
                <>
                  <div className="mt-6 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTab('follow-up')}
                      className={`rounded px-3 py-2 text-sm font-bold ${
                        tab === 'follow-up'
                          ? 'bg-sky-400 text-slate-950'
                          : 'border border-slate-600'
                      }`}
                    >
                      Needs follow-up ({followUp.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('active')}
                      className={`rounded px-3 py-2 text-sm font-bold ${
                        tab === 'active'
                          ? 'bg-sky-400 text-slate-950'
                          : 'border border-slate-600'
                      }`}
                    >
                      Active access ({active.length})
                    </button>
                  </div>
                  <div className="mt-4 divide-y divide-slate-800 border border-slate-700">
                    {rows.map((row) => (
                      <article key={row.recipient} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-bold">{row.recipient}</p>
                            {row.studentId ? (
                              <p className="mt-1 text-xs text-slate-400">
                                Existing Student
                              </p>
                            ) : null}
                            <p className="mt-1 text-sm text-slate-300">
                              Class Membership{' '}
                              {row.membershipStatus.replaceAll('_', ' ')} ·
                              Invitation{' '}
                              {row.latestInvitation.status.replaceAll('_', ' ')}{' '}
                              · Delivery {row.deliveryStatus}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              {lastTransitionLabel(row)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-3">
                              {row.membershipStatus === 'active' &&
                              row.classMembershipId ? (
                                <button
                                  type="button"
                                  className="text-xs font-bold text-rose-300"
                                  onClick={() =>
                                    setConfirm({
                                      kind: 'deactivate',
                                      classMembershipId: row.classMembershipId!,
                                    })
                                  }
                                >
                                  Deactivate Class Membership
                                </button>
                              ) : null}
                              {row.membershipStatus !== 'active' &&
                              RESENDABLE_STATUSES.includes(
                                row.latestInvitation.status,
                              ) ? (
                                <>
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-sky-300"
                                    onClick={() =>
                                      void resend(row.latestInvitation.invitationId)
                                    }
                                  >
                                    Resend
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-rose-300"
                                    onClick={() =>
                                      setConfirm({
                                        kind: 'revoke',
                                        invitationId:
                                          row.latestInvitation.invitationId,
                                      })
                                    }
                                  >
                                    Revoke Invitation
                                  </button>
                                </>
                              ) : null}
                            </div>
                        </div>
                        <button
                          type="button"
                          className="mt-2 text-xs font-bold text-slate-400"
                          onClick={() =>
                            setHistoryOpen((current) =>
                              current === row.recipient
                                ? undefined
                                : row.recipient,
                            )
                          }
                        >
                          {historyOpen === row.recipient
                            ? 'Hide lifecycle history'
                            : 'Show lifecycle history'}
                        </button>
                        {historyOpen === row.recipient ? (
                          <ul className="mt-2 grid gap-1 text-xs text-slate-400">
                            {row.history.map((item) => (
                              <li key={item.invitationId}>
                                {item.status.replaceAll('_', ' ')} · generation{' '}
                                {item.generation} · {item.createdAt}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mt-6 grid gap-3">
                  <p className="text-sm text-slate-400">
                    This Class is empty. Choose how to invite Students.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEmptyChoice('email');
                        setCsvOpen(false);
                        resetCsv();
                      }}
                      className="rounded bg-sky-400 px-4 py-2 font-black text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Add one email address
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEmptyChoice('csv');
                        setCsvOpen(true);
                      }}
                      className="rounded border border-slate-600 px-4 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Import a CSV
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">
              Create a Class, then add one email address or import a CSV.
            </p>
          )}
        </div>
      </div>

      <section className="mt-10">
        <h3 className="text-lg font-black">Closed classes</h3>
        <p className="mt-1 text-sm text-slate-400">
          Closed Classes are read-only administrative history. They do not show
          clinical or progress information.
        </p>
        <div className="mt-3 grid gap-2">
          {closedClasses.map((entry) => (
            <button
              key={entry.classId}
              type="button"
              onClick={() => {
                setHistoryClassId(entry.classId);
              }}
              className="rounded border border-slate-700 p-3 text-left"
            >
              <span className="font-bold">{entry.name}</span>
              <span className="mt-1 block text-xs text-slate-400">
                Closed {entry.closedAt ?? ''}
              </span>
            </button>
          ))}
        </div>
        {historyClass ? (
          <div className="mt-4 divide-y divide-slate-800 border border-slate-700">
            <p className="p-4 text-sm text-slate-400">
              {historyClass.name} · Closed Class · read-only history
            </p>
            {historyClass.relationships.map((row) => (
              <article key={row.recipient} className="p-4">
                <p className="font-bold">{row.recipient}</p>
                <p className="mt-1 text-sm text-slate-300">
                  Class Membership {row.membershipStatus.replaceAll('_', ' ')} ·
                  Invitation {row.latestInvitation.status.replaceAll('_', ' ')} ·
                  Delivery {row.deliveryStatus}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {lastTransitionLabel(row)}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <p aria-live="polite" className="mt-4 text-sm text-slate-300">
        {message}
      </p>

      {csvConfirmOpen ? (
        <ConfirmDialog
          title="Confirm bulk Invitation send"
          body="Re-enter password and authenticator code. Only selected ready rows will create Invitations. Delivery is pending and is not Invitation state."
          confirmLabel={`Confirm and send ${selectedLines.length} Invitations`}
          busy={busy}
          onConfirm={() => void sendCsvInvitations()}
          onCancel={() => {
            setCsvConfirmOpen(false);
            setCsvPassword('');
            setCsvTotp('');
          }}
        >
          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 font-bold" htmlFor="csv-step-up-password">
              Password
              <input
                id="csv-step-up-password"
                type="password"
                autoComplete="current-password"
                value={csvPassword}
                onChange={(event) => setCsvPassword(event.target.value)}
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            <label className="grid gap-2 font-bold" htmlFor="csv-step-up-totp">
              Authenticator code
              <input
                id="csv-step-up-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={csvTotp}
                onChange={(event) => setCsvTotp(event.target.value)}
                className="rounded border border-slate-600 bg-slate-950 px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
          </div>
        </ConfirmDialog>
      ) : null}
      {confirm?.kind === 'revoke' ? (
        <ConfirmDialog
          title="Revoke Invitation"
          body="Outstanding Invitation Codes become unusable. An already-redeemed Class Membership is unaffected."
          confirmLabel="Revoke Invitation"
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        />
      ) : null}
      {confirm?.kind === 'deactivate' ? (
        <ConfirmDialog
          title="Deactivate Class Membership"
          body="Only this Class access ends. The Student identity, other active Class Memberships, Intake Record, and Learning Progress remain. Reactivation requires a fresh Invitation."
          confirmLabel="Deactivate Class Membership"
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        />
      ) : null}
      {confirm?.kind === 'close' ? (
        <ConfirmDialog
          title="Close Class"
          body="This closes the Class. Pending Invitations are revoked and active Class Memberships are deactivated. History is preserved. Reuse requires creating a new Class."
          confirmLabel="Close Class"
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        />
      ) : null}
    </div>
  );
}
