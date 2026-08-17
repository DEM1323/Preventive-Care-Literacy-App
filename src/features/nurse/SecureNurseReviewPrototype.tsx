import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

// PROTOTYPE: Three variants of secure nurse record review, switchable via ?variant= on /nurse.

type VariantKey = 'A' | 'B' | 'C';

interface FlowProps {
  fresh: boolean;
  searched: boolean;
  recordOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onAuthenticate: () => void;
  onSearch: () => void;
  onOpenRecord: () => void;
  onCoverRecord: () => void;
  onExpireFreshness: () => void;
}

const variants: Array<{ key: VariantKey; name: string }> = [
  { key: 'A', name: 'Guided reveal' },
  { key: 'B', name: 'Browsable directory' },
  { key: 'C', name: 'Privacy curtain' },
];

const student = {
  name: 'Maya Joseph',
  studentId: 'ST-1048',
  email: 'maya.joseph@example.edu',
  classes: ['Grade 10 Health', 'Spring Wellness'],
  submittedAt: 'August 15, 2026 at 9:42 AM',
  locale: 'Haitian Creole',
  version: 'Version 3',
  release: 'Intake Form 2026.3',
};

const directoryStudents = [
  { id: 'ST-1048', name: 'Maya Joseph', email: 'maya.joseph@example.edu', classes: ['Grade 10 Health', 'Spring Wellness'], state: 'Current', submitted: 'Aug 15, 2026', disabled: false },
  { id: 'ST-1021', name: 'Aaliyah Brown', email: 'aaliyah.brown@example.edu', classes: ['Grade 10 Health'], state: 'Current', submitted: 'Aug 12, 2026', disabled: false },
  { id: 'ST-1072', name: 'Ethan Chen', email: 'ethan.chen@example.edu', classes: ['Spring Wellness'], state: 'Update required', submitted: 'Apr 28, 2026', disabled: false },
  { id: 'ST-1095', name: 'Jordan Smith', email: 'jordan.smith@example.edu', classes: ['Grade 10 Health'], state: 'Current', submitted: 'Jul 19, 2026', disabled: true },
  { id: 'ST-1013', name: 'Luis Santos', email: 'luis.santos@example.edu', classes: [], state: 'No accepted record', submitted: '—', disabled: false },
];

const answerGroups = [
  {
    title: 'Health overview',
    answers: [
      ['Primary care provider', 'Dr. Elena Ruiz'],
      ['Last physical examination', 'June 12, 2026'],
      ['Ongoing health concerns', 'Asthma'],
    ],
  },
  {
    title: 'Allergies and medication',
    answers: [
      ['Known allergies', 'Peanuts'],
      ['Current medication', 'Albuterol inhaler'],
      ['Medication details', 'As needed before physical activity'],
    ],
  },
  {
    title: 'Student notes',
    answers: [
      ['Original free text', 'Mwen pote ponp mwen nan sak lekòl mwen.'],
      ['Submission language', 'Haitian Creole'],
    ],
  },
];

function ClinicalFreshness({ compact = false, onExpire }: { compact?: boolean; onExpire?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 ${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}>
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Clinical access fresh · 14:42
      </div>
      {onExpire && <button type="button" onClick={onExpire} className="text-xs font-bold text-slate-500 underline decoration-dotted underline-offset-4">Simulate expiry</button>}
    </div>
  );
}

function StepUpFields({ onAuthenticate, dark = false }: { onAuthenticate: () => void; dark?: boolean }) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className={`mb-1.5 block text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>Password</span>
        <input
          type="password"
          placeholder="Any value works in this prototype"
          className={`w-full rounded-xl border px-4 py-3 outline-none ring-emerald-500 focus:ring-2 ${dark ? 'border-slate-600 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-300 bg-white'}`}
        />
      </label>
      <label className="block">
        <span className={`mb-1.5 block text-sm font-semibold ${dark ? 'text-slate-200' : 'text-slate-700'}`}>6-digit authenticator code</span>
        <input
          inputMode="numeric"
          placeholder="000 000"
          className={`w-full rounded-xl border px-4 py-3 font-mono tracking-[0.35em] outline-none ring-emerald-500 focus:ring-2 ${dark ? 'border-slate-600 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-300 bg-white'}`}
        />
      </label>
      <button
        type="button"
        onClick={onAuthenticate}
        className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        Confirm and continue
      </button>
      <p className={`text-xs leading-relaxed ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
        Re-authentication unlocks clinical search and records for 15 minutes. Your staff session remains active afterward.
      </p>
    </div>
  );
}

function SearchBox({ query, onQueryChange, onSearch, dark = false }: Pick<FlowProps, 'query' | 'onQueryChange' | 'onSearch'> & { dark?: boolean }) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
      <label className="flex-1">
        <span className="sr-only">Student name, school ID, or email</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Student name, school ID, or email"
          className={`w-full rounded-xl border px-4 py-3 outline-none ring-emerald-500 focus:ring-2 ${dark ? 'border-slate-600 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-300 bg-white'}`}
        />
      </label>
      <button type="submit" className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700">
        <i className="fa-solid fa-magnifying-glass mr-2" />
        Search
      </button>
    </form>
  );
}

function AuditReceipt({ minimal = false, historical = false }: { minimal?: boolean; historical?: boolean }) {
  return (
    <aside className={minimal ? 'text-xs text-slate-500' : 'rounded-2xl border border-sky-200 bg-sky-50 p-4'}>
      <div className={`flex items-start gap-3 ${minimal ? '' : 'text-sky-950'}`}>
        <i className="fa-solid fa-shield-halved mt-0.5 text-sky-600" />
        <div>
          <p className="font-bold">This reveal was recorded</p>
          {!minimal && (
            <p className="mt-1 text-sm leading-relaxed text-sky-800">
              {historical ? 'Superseded version 2' : 'Current record'} opened by David Martinez at 10:42 AM. Viewing is an access event, not a clinical review or follow-up.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function PrintBoundary({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="print:hidden">{children}</div>
      <div className="hidden rounded-xl border-2 border-slate-900 p-8 text-center print:block">
        Clinical content is hidden from application print output.
      </div>
    </>
  );
}

function GuidedReveal(props: FlowProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyWarning, setHistoryWarning] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Clinical records · Prototype A</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Find one student, then reveal one record</h1>
        </div>
        {props.fresh && <ClinicalFreshness onExpire={props.onExpireFreshness} />}
      </div>

      <ol className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white text-sm font-bold">
        {['Authenticate', 'Locate student', 'Read record'].map((label, index) => {
          const active = props.recordOpen ? index === 2 : props.fresh ? index === 1 : index === 0;
          return <li key={label} className={`border-r border-slate-200 px-3 py-3 text-center last:border-r-0 ${active ? 'bg-emerald-700 text-white' : 'text-slate-400'}`}>{index + 1}. {label}</li>;
        })}
      </ol>

      {!props.fresh && (
        <div className="grid overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:grid-cols-[1.05fr_0.95fr]">
          <div className="bg-slate-950 p-8 text-white sm:p-10">
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-xl"><i className="fa-solid fa-user-shield" /></div>
            <h2 className="text-2xl font-black">Start with who you need. Results stay covered.</h2>
            <p className="mt-3 leading-relaxed text-slate-300">The query remains memory-only until both factors are confirmed. Searches and record reveals are separately audited.</p>
            <p className="mt-8 border-t border-slate-700 pt-5 text-sm text-slate-400">Signed in as David Martinez · School Nurse</p>
          </div>
          <div className="p-8 sm:p-10">
            {!props.searched ? (
              <>
                <h2 className="mb-2 text-xl font-black text-slate-950">Locate a Student</h2>
                <p className="mb-5 text-sm text-slate-500">No query is sent until re-authentication succeeds.</p>
                <SearchBox {...props} />
              </>
            ) : (
              <>
                <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"><span className="block text-xs font-bold uppercase text-slate-400">Staged query</span>{props.query || 'Student search'}</div>
                <StepUpFields onAuthenticate={props.onAuthenticate} />
              </>
            )}
          </div>
        </div>
      )}

      {props.fresh && !props.recordOpen && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-black text-slate-950">Locate a Student</h2>
          <p className="mb-5 mt-1 text-sm text-slate-500">Searches are recorded. Results show only identity and Class context.</p>
          <SearchBox {...props} />
          {props.searched && (
            <div className="mt-6 rounded-2xl border border-slate-200 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-black text-slate-950">{student.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{student.studentId} · {student.email}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-600">Active: {student.classes.join(' · ')}</p>
                </div>
                <button type="button" onClick={props.onOpenRecord} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white hover:bg-emerald-800">Continue to record <i className="fa-solid fa-arrow-right ml-2" /></button>
              </div>
              <p className="mt-4 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-500"><i className="fa-solid fa-shield-halved mr-2 text-sky-600" />Continuing makes an audited reveal attempt. The match does not disclose whether a retained Intake Record exists.</p>
            </div>
          )}
        </div>
      )}

      {props.fresh && props.recordOpen && (
        <div className="space-y-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={`text-xs font-bold uppercase tracking-widest ${viewingHistory ? 'text-amber-700' : 'text-emerald-700'}`}>{viewingHistory ? 'Superseded version · Not current' : 'Current accepted record'}</p>
                <h2 className="mt-1 text-3xl font-black text-slate-950">{student.name}</h2>
                <p className="mt-2 text-sm text-slate-500">{student.studentId} · {viewingHistory ? 'Version 2 · Submitted May 10, 2026' : `${student.version} · Submitted ${student.submittedAt}`}</p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <button type="button" onClick={props.onCoverRecord} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"><i className="fa-solid fa-eye-slash mr-2" />Cover record</button>
                <div className="rounded-xl bg-slate-100 px-4 py-3 text-sm"><span className="block text-xs font-bold uppercase text-slate-500">Source</span>{viewingHistory ? 'Intake Form 2026.1' : student.release} · {student.locale}</div>
              </div>
            </div>
            <div className="my-5"><AuditReceipt historical={viewingHistory} /></div>
            {!viewingHistory && <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><strong>Changed since version 2:</strong> Known allergies and medication details. This is a factual field-change summary, not a risk ranking.</div>}
            {viewingHistory && <button type="button" onClick={() => setViewingHistory(false)} className="mb-5 text-sm font-bold text-emerald-700"><i className="fa-solid fa-arrow-left mr-2" />Return to current version</button>}
            <PrintBoundary>
              <div className="grid gap-4 md:grid-cols-2">
                {answerGroups.map((group) => (
                  <section key={group.title} className="rounded-2xl border border-slate-200 p-5 last:md:col-span-2">
                    <h3 className="font-black text-slate-950">{group.title}</h3>
                    <dl className="mt-4 space-y-4">
                      {group.answers.map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 text-slate-900">{value}</dd></div>)}
                    </dl>
                  </section>
                ))}
              </div>
            </PrintBoundary>
            {!viewingHistory && <button type="button" onClick={() => setHistoryOpen(!historyOpen)} className="mt-6 w-full rounded-xl border border-slate-300 px-4 py-3 text-left font-bold text-slate-700">
              <i className="fa-solid fa-clock-rotate-left mr-2 text-slate-400" />2 prior versions <span className="float-right">{historyOpen ? '−' : '+'}</span>
            </button>}
            {historyOpen && !viewingHistory && (
              <div className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><strong>Version 2 · Superseded</strong><br />May 10, 2026 · Intake Form 2026.1 · 2 fields later changed</div><button type="button" onClick={() => setHistoryWarning(true)} className="rounded-lg border border-amber-400 bg-white px-4 py-2 font-bold">Choose version</button></div>
                {historyWarning && <div className="mt-4 border-t border-amber-200 pt-4"><p><i className="fa-solid fa-shield-halved mr-2" /><strong>Historical reveal is recorded separately.</strong> This version will replace the current version on screen and remain visibly marked as superseded.</p><div className="mt-3 flex gap-3"><button type="button" onClick={() => setHistoryWarning(false)} className="rounded-lg px-3 py-2 font-bold text-slate-600">Cancel</button><button type="button" onClick={() => { setViewingHistory(true); setHistoryOpen(false); setHistoryWarning(false); }} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white">Reveal version 2</button></div></div>}
              </div>
            )}
            <p className="mt-6 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">No copy, export, download, or print action is provided. The app cannot prevent screenshots or determined use of browser tools.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ClinicalWorkspace(props: FlowProps) {
  const [filter, setFilter] = useState('All Students');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [accessReason, setAccessReason] = useState('Student support follow-up');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyWarning, setHistoryWarning] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);

  const visibleStudents = directoryStudents.filter((entry) => {
    const text = `${entry.name} ${entry.id} ${entry.email}`.toLowerCase();
    const matchesQuery = text.includes(props.query.toLowerCase());
    const matchesFilter = filter === 'All Students'
      || (filter === 'No active Class' && entry.classes.length === 0)
      || (filter === 'Disabled Students' && entry.disabled)
      || entry.classes.includes(filter);
    return matchesQuery && matchesFilter;
  });
  const selected = directoryStudents.find((entry) => entry.id === selectedId) ?? null;
  const pending = directoryStudents.find((entry) => entry.id === pendingId) ?? null;

  const openStudent = (id: string) => {
    const entry = directoryStudents.find((candidate) => candidate.id === id);
    if (!entry) return;
    setViewingHistory(false);
    setHistoryOpen(false);
    setHistoryWarning(false);
    if (entry.disabled || entry.classes.length === 0) {
      setPendingId(id);
      return;
    }
    setSelectedId(id);
    props.onOpenRecord();
  };

  const confirmRestrictedAccess = () => {
    if (!pendingId || !accessReason) return;
    setSelectedId(pendingId);
    setPendingId(null);
    props.onOpenRecord();
  };

  return (
    <section className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-slate-950 sm:-mx-6 lg:-mx-8">
      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[320px_1fr]">
        <aside className="border-b border-slate-700 bg-slate-900 p-5 text-white lg:border-b-0 lg:border-r">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">Prototype B · Clinical</p>
          <div className="mt-5 flex items-center justify-between"><h1 className="text-xl font-black">Student directory</h1>{props.fresh && <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />}</div>
          {!props.fresh && <p className="mt-5 rounded-xl border border-amber-700/60 bg-amber-950/40 p-3 text-xs leading-relaxed text-amber-200"><i className="fa-solid fa-lock mr-2" />The Student directory stays hidden until clinical access is fresh.</p>}
          {props.fresh && (
            <>
              <label className="mt-5 block"><span className="sr-only">Search Students</span><input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search name, ID, or email" className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white outline-none ring-emerald-500 placeholder:text-slate-500 focus:ring-2" /></label>
              <label className="mt-3 block"><span className="sr-only">Filter by Class</span><select value={filter} onChange={(event) => setFilter(event.target.value)} className="w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-white outline-none"><option>All Students</option><option>Grade 10 Health</option><option>Spring Wellness</option><option>No active Class</option><option>Disabled Students</option></select></label>
              <p className="mt-4 text-xs leading-relaxed text-slate-400"><i className="fa-solid fa-shield-halved mr-2 text-sky-400" />Opening this directory was recorded. Selecting a Student creates a separate reveal event.</p>
              <div className="mt-4 space-y-2">
                {visibleStudents.map((entry) => (
                  <button key={entry.id} type="button" onClick={() => openStudent(entry.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedId === entry.id && props.recordOpen ? 'border-emerald-400 bg-emerald-500/15' : 'border-slate-700 bg-slate-800 hover:border-slate-500'}`}>
                    <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{entry.name}</p><p className="mt-0.5 text-xs text-slate-400">{entry.id} · {entry.classes.length > 0 ? entry.classes.join(', ') : 'No active Class'}</p></div>{entry.disabled && <span className="rounded-full bg-amber-900 px-2 py-0.5 text-[10px] font-bold text-amber-200">Disabled</span>}</div>
                    <div className="mt-3 flex items-center justify-between text-xs"><span className={entry.state === 'Update required' ? 'font-bold text-amber-300' : entry.state === 'No accepted record' ? 'text-slate-400' : 'font-bold text-emerald-300'}>{entry.state}</span><span className="text-slate-500">{entry.submitted}</span></div>
                  </button>
                ))}
                {visibleStudents.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-sm text-slate-500">No Students match these filters.</p>}
              </div>
            </>
          )}
        </aside>

        <main className="bg-slate-100 p-5 sm:p-8">
          {!props.fresh && (
            <div className="mx-auto mt-6 max-w-lg rounded-3xl bg-slate-900 p-7 text-white shadow-2xl sm:mt-16 sm:p-9">
              <div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-black">Unlock clinical workspace</h2><i className="fa-solid fa-fingerprint text-3xl text-emerald-400" /></div>
              <StepUpFields onAuthenticate={props.onAuthenticate} dark />
            </div>
          )}
          {props.fresh && pending && (
            <div className="mx-auto mt-8 max-w-xl rounded-3xl border border-amber-200 bg-white p-7 shadow-lg">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-700">Additional access reason required</p><h2 className="mt-2 text-2xl font-black text-slate-950">{pending.name}</h2><p className="mt-2 text-sm text-slate-600">{pending.disabled ? 'This Student is disabled.' : 'This Student has no active Class Membership.'} Clinical Permission still allows access, but the reason is recorded with the reveal.</p>
              <label className="mt-5 block"><span className="mb-1.5 block text-sm font-bold text-slate-700">Access reason</span><select value={accessReason} onChange={(event) => setAccessReason(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3"><option>Student support follow-up</option><option>Record correction request</option><option>Authorized disclosure preparation</option></select></label>
              <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setPendingId(null)} className="rounded-xl px-4 py-2 font-bold text-slate-600">Cancel</button><button type="button" onClick={confirmRestrictedAccess} className="rounded-xl bg-emerald-700 px-5 py-2 font-bold text-white">Continue to record</button></div>
            </div>
          )}
          {props.fresh && !props.recordOpen && !pending && (
            <div className="flex min-h-[520px] items-center justify-center text-center text-slate-500"><div><i className="fa-solid fa-users-viewfinder text-5xl text-slate-300" /><h2 className="mt-5 text-xl font-black text-slate-700">Select a Student</h2><p className="mt-2 text-sm">Use Class filters or search, then click a Student to load full details.</p><button type="button" onClick={props.onExpireFreshness} className="mt-6 text-xs font-bold text-slate-500 underline decoration-dotted underline-offset-4">Simulate freshness expiry</button></div></div>
          )}
          {props.fresh && props.recordOpen && selected && !pending && (
            <div className="mx-auto max-w-6xl">
              <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div><p className={`text-xs font-bold uppercase tracking-widest ${viewingHistory ? 'text-amber-700' : 'text-emerald-700'}`}>{viewingHistory ? 'Superseded version · Not current' : 'Full Student details'}</p><h2 className="text-3xl font-black text-slate-950">{selected.name}</h2><p className="text-sm text-slate-500">{selected.id} · {selected.email} · {selected.classes.length > 0 ? selected.classes.join(' · ') : 'No active Class'}</p></div>
                <ClinicalFreshness onExpire={props.onExpireFreshness} />
              </div>
              {selected.state === 'No accepted record' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm"><i className="fa-regular fa-file-lines text-5xl text-slate-300" /><h3 className="mt-5 text-xl font-black text-slate-800">No accepted Intake Record</h3><p className="mt-2 text-sm text-slate-500">The audited reveal found no retained record. Intake Draft content is never visible here.</p></div>
              ) : (
                <>
                  <AuditReceipt historical={viewingHistory} />
                  {!viewingHistory && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"><strong>Changed since version 2:</strong> Known allergies and medication details. This is a factual field-change summary, not a risk ranking.</div>}
                  {viewingHistory && <button type="button" onClick={() => setViewingHistory(false)} className="mt-5 text-sm font-bold text-emerald-700"><i className="fa-solid fa-arrow-left mr-2" />Return to current version</button>}
                  <PrintBoundary>
                    <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      {answerGroups.map((group) => (
                        <section key={group.title} className="grid border-b border-slate-200 last:border-b-0 md:grid-cols-[220px_1fr]">
                          <h3 className="bg-slate-50 p-5 font-black text-slate-900">{group.title}</h3>
                          <dl className="divide-y divide-slate-100 px-5">{group.answers.map(([label, value]) => <div key={label} className="grid gap-1 py-4 sm:grid-cols-[220px_1fr]"><dt className="text-sm font-semibold text-slate-500">{label}</dt><dd className="text-slate-950">{value}</dd></div>)}</dl>
                        </section>
                      ))}
                    </div>
                  </PrintBoundary>
                  {!viewingHistory && <button type="button" onClick={() => setHistoryOpen(!historyOpen)} className="mt-5 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-bold"><i className="fa-solid fa-code-branch mr-2 text-slate-400" />2 superseded versions retained <span className="float-right">{historyOpen ? '−' : '+'}</span></button>}
                  {historyOpen && !viewingHistory && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span><strong>Version 2 · Superseded</strong><br />May 10, 2026 · 2 fields later changed</span><button type="button" onClick={() => setHistoryWarning(true)} className="rounded-lg border border-amber-400 bg-white px-4 py-2 font-bold">Choose version</button></div>{historyWarning && <div className="mt-4 border-t border-amber-200 pt-4"><strong>Historical reveal is recorded separately.</strong><div className="mt-3 flex gap-3"><button type="button" onClick={() => setHistoryWarning(false)} className="px-3 py-2 font-bold text-slate-600">Cancel</button><button type="button" onClick={() => { setViewingHistory(true); setHistoryOpen(false); setHistoryWarning(false); }} className="rounded-lg bg-amber-700 px-4 py-2 font-bold text-white">Reveal version 2</button></div></div>}</div>}
                  <p className="mt-5 text-xs leading-relaxed text-slate-500">No copy, export, download, or print action is provided. The app cannot prevent screenshots or determined use of browser tools.</p>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function PrivacyCurtain(props: FlowProps) {
  const readyToConfirm = props.fresh && props.searched && !props.recordOpen;

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-7 text-center">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-700">Prototype C · Private focus</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">One student. One deliberate reveal.</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">A privacy curtain replaces lists and persistent navigation so clinical information is less likely to remain exposed in shared spaces.</p>
      </div>

      {!props.fresh && (
        <div className="overflow-hidden rounded-[2rem] bg-violet-950 text-white shadow-xl">
          <div className="border-b border-violet-800 bg-[radial-gradient(circle_at_top_right,_#7c3aed,_transparent_45%)] p-8 sm:p-10"><i className="fa-solid fa-eye-slash text-3xl text-violet-300" /><h2 className="mt-5 text-2xl font-black">Clinical view is covered</h2><p className="mt-2 max-w-lg text-violet-200">Confirm both factors before the app accepts a Student search. The curtain returns when freshness expires.</p></div>
          <div className="p-8 sm:p-10"><StepUpFields onAuthenticate={props.onAuthenticate} dark /></div>
        </div>
      )}

      {props.fresh && !props.searched && (
        <div className="rounded-[2rem] border border-violet-200 bg-white p-8 shadow-sm sm:p-12">
          <div className="mb-8 flex items-center justify-center"><ClinicalFreshness /></div>
          <h2 className="text-center text-2xl font-black text-slate-950">Who do you need to locate?</h2>
          <p className="mb-6 mt-2 text-center text-sm text-slate-500">Your search terms and result count will be recorded.</p>
          <SearchBox {...props} />
        </div>
      )}

      {readyToConfirm && (
        <div className="rounded-[2rem] border border-violet-200 bg-white p-7 shadow-xl sm:p-10">
          <p className="text-center text-xs font-black uppercase tracking-widest text-violet-700">Confirm the match before revealing clinical data</p>
          <div className="mx-auto my-8 max-w-lg rounded-2xl bg-slate-100 p-6 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-200 text-xl font-black text-violet-900">MJ</div><h2 className="mt-4 text-2xl font-black">{student.name}</h2><p className="mt-1 text-sm text-slate-500">{student.studentId} · {student.email}</p><p className="mt-3 text-xs font-semibold text-slate-600">{student.classes.join(' · ')}</p></div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><i className="fa-solid fa-circle-info mr-2" /><strong>Opening is audited.</strong> It does not mark this record reviewed or indicate follow-up.</div>
          <button type="button" onClick={props.onOpenRecord} className="mt-5 w-full rounded-xl bg-violet-700 px-5 py-4 font-black text-white hover:bg-violet-800">Reveal current Intake Record</button>
        </div>
      )}

      {props.fresh && props.recordOpen && (
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg">
          <div className="bg-violet-950 p-6 text-white sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-violet-300">Current accepted record · {student.version}</p><h2 className="mt-1 text-3xl font-black">{student.name}</h2><p className="mt-2 text-sm text-violet-200">Submitted {student.submittedAt} · {student.locale}</p></div><button type="button" onClick={props.onSearch} className="rounded-xl border border-violet-500 px-4 py-2 text-sm font-bold hover:bg-violet-900"><i className="fa-solid fa-eye-slash mr-2" />Cover record</button></div>
            <div className="mt-5 rounded-xl bg-violet-900 p-3 text-violet-100"><AuditReceipt minimal /></div>
          </div>
          <PrintBoundary>
            <div className="p-6 sm:p-8">
              {answerGroups.map((group, groupIndex) => (
                <section key={group.title} className="relative border-l-2 border-violet-200 pb-9 pl-7 last:pb-0"><span className="absolute -left-4 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-violet-700 text-sm font-black text-white">{groupIndex + 1}</span><h3 className="text-lg font-black text-slate-950">{group.title}</h3><dl className="mt-5 grid gap-5 sm:grid-cols-2">{group.answers.map(([label, value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 leading-relaxed text-slate-950">{value}</dd></div>)}</dl></section>
              ))}
            </div>
          </PrintBoundary>
          <div className="border-t border-slate-200 bg-slate-50 p-5 text-center text-xs leading-relaxed text-slate-500">No copy, export, download, or print action is provided. The app cannot prevent screenshots or determined use of browser tools.</div>
        </div>
      )}
    </section>
  );
}

function PrototypeSwitcher({ current, onReset }: { current: VariantKey; onReset: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentIndex = variants.findIndex((variant) => variant.key === current);

  const select = (offset: number) => {
    const next = variants[(currentIndex + offset + variants.length) % variants.length];
    const updated = new URLSearchParams(searchParams);
    updated.set('variant', next.key);
    setSearchParams(updated, { replace: true });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') select(-1);
      if (event.key === 'ArrowRight') select(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-950 p-1.5 text-white shadow-2xl ring-1 ring-white/20">
      <button type="button" aria-label="Previous variant" onClick={() => select(-1)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-700">←</button>
      <span className="min-w-44 px-3 text-center text-xs font-bold">{current} · {variants[currentIndex].name}</span>
      <button type="button" aria-label="Next variant" onClick={() => select(1)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-700">→</button>
      <button type="button" onClick={onReset} className="mr-1 rounded-full bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20">Reset</button>
    </div>
  );
}

export function SecureNurseReviewPrototype() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('variant')?.toUpperCase();
  const variant: VariantKey = requested === 'B' || requested === 'C' ? requested : 'A';
  const [fresh, setFresh] = useState(false);
  const [searched, setSearched] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [query, setQuery] = useState('');

  const reset = () => {
    setFresh(false);
    setSearched(false);
    setRecordOpen(false);
    setQuery('');
  };

  const props: FlowProps = {
    fresh,
    searched,
    recordOpen,
    query,
    onQueryChange: setQuery,
    onAuthenticate: () => setFresh(true),
    onSearch: () => {
      setSearched(true);
      setRecordOpen(false);
    },
    onOpenRecord: () => setRecordOpen(true),
    onCoverRecord: () => {
      setSearched(false);
      setRecordOpen(false);
      setQuery('');
    },
    onExpireFreshness: () => {
      setFresh(false);
      setSearched(false);
      setRecordOpen(false);
      setQuery('');
    },
  };

  return (
    <>
      {variant === 'A' && <GuidedReveal {...props} />}
      {variant === 'B' && <ClinicalWorkspace {...props} />}
      {variant === 'C' && <PrivacyCurtain {...props} />}
      <PrototypeSwitcher current={variant} onReset={reset} />
    </>
  );
}
