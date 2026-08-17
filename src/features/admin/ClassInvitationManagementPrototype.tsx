import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

// PROTOTYPE: Three variants of Class and Invitation management, switchable via ?variant= on /prototype/class-invitations.

type VariantKey = 'A' | 'B' | 'C';
type InvitationStatus = 'Pending' | 'Redeemed' | 'Expired' | 'Revoked';
type MembershipStatus = 'None' | 'Active' | 'Inactive';

interface ClassGroup { id: string; name: string; note: string }
interface RosterEntry {
  id: string;
  classId: string;
  email: string;
  studentName?: string;
  invitation: InvitationStatus;
  membership: MembershipStatus;
  changed: string;
}
interface PrototypeProps {
  classes: ClassGroup[];
  entries: RosterEntry[];
  selectedClassId: string;
  activity: string[];
  onSelectClass: (id: string) => void;
  onOpenCreateClass: () => void;
  onOpenInvite: () => void;
  onOpenCsv: () => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  onDeactivate: (id: string) => void;
  onReinvite: (id: string) => void;
}

const variants: Array<{ key: VariantKey; name: string }> = [
  { key: 'A', name: 'Class workspace' },
  { key: 'B', name: 'Operations queue' },
  { key: 'C', name: 'Guided workflow' },
];
const initialClasses: ClassGroup[] = [
  { id: 'health-10', name: 'Grade 10 Health', note: 'Fall 2026 invitation group' },
  { id: 'spring-wellness', name: 'Spring Wellness', note: 'Open enrollment pilot' },
];
const initialEntries: RosterEntry[] = [
  { id: 'maya-health', classId: 'health-10', email: 'maya.joseph@example.edu', studentName: 'Maya Joseph', invitation: 'Redeemed', membership: 'Active', changed: 'Redeemed Aug 15' },
  { id: 'aaliyah-health', classId: 'health-10', email: 'aaliyah.brown@example.edu', studentName: 'Aaliyah Brown', invitation: 'Redeemed', membership: 'Active', changed: 'Redeemed Aug 12' },
  { id: 'ethan-health', classId: 'health-10', email: 'ethan.chen@example.edu', invitation: 'Pending', membership: 'None', changed: 'Sent Aug 16 · expires Aug 23' },
  { id: 'jordan-health', classId: 'health-10', email: 'jordan.smith@example.edu', invitation: 'Expired', membership: 'None', changed: 'Expired Aug 14' },
  { id: 'maya-spring', classId: 'spring-wellness', email: 'maya.joseph@example.edu', studentName: 'Maya Joseph', invitation: 'Redeemed', membership: 'Active', changed: 'Existing Student · joined Aug 16' },
  { id: 'luis-spring', classId: 'spring-wellness', email: 'luis.santos@example.edu', invitation: 'Revoked', membership: 'None', changed: 'Revoked Aug 15' },
];
const csvRows = [
  { email: 'sofia.ortiz@example.edu', outcome: 'Ready', detail: 'New email address' },
  { email: 'noah.williams@example.edu', outcome: 'Ready', detail: 'New email address' },
  { email: 'ethan.chen@example.edu', outcome: 'Already invited', detail: 'Pending in this Class' },
  { email: 'not-an-email', outcome: 'Malformed', detail: 'Not an email address' },
  { email: 'maya.joseph@example.edu', outcome: 'Already a member', detail: 'Active in this Class' },
];

function InvitationBadge({ status }: { status: InvitationStatus }) {
  const tone = status === 'Redeemed' ? 'bg-emerald-100 text-emerald-800' : status === 'Pending' ? 'bg-sky-100 text-sky-800' : status === 'Expired' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{status}</span>;
}

function EntryActions({ entry, props }: { entry: RosterEntry; props: PrototypeProps }) {
  if (entry.membership === 'Active') return <button type="button" onClick={() => props.onDeactivate(entry.id)} className="text-xs font-bold text-rose-700 hover:underline">Deactivate membership</button>;
  if (entry.membership === 'Inactive') return <button type="button" onClick={() => props.onReinvite(entry.id)} className="text-xs font-bold text-emerald-700 hover:underline">Send fresh Invitation</button>;
  if (entry.invitation === 'Pending') return <div className="flex gap-3"><button type="button" onClick={() => props.onResend(entry.id)} className="text-xs font-bold text-sky-700 hover:underline">Resend</button><button type="button" onClick={() => props.onRevoke(entry.id)} className="text-xs font-bold text-rose-700 hover:underline">Revoke</button></div>;
  return <button type="button" onClick={() => props.onReinvite(entry.id)} className="text-xs font-bold text-emerald-700 hover:underline">Create replacement</button>;
}

function ClassWorkspace(props: PrototypeProps) {
  const selected = props.classes.find((group) => group.id === props.selectedClassId) ?? props.classes[0];
  const entries = props.entries.filter((entry) => entry.classId === selected?.id);
  const active = entries.filter((entry) => entry.membership === 'Active').length;
  const pending = entries.filter((entry) => entry.invitation === 'Pending').length;
  return (
    <section className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-stone-100 sm:-mx-6 lg:-mx-8">
      <div className="border-b border-stone-200 bg-white px-5 py-5 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-teal-700">Prototype A · Class-first</p><h1 className="mt-1 text-2xl font-black text-stone-950">Classes and access</h1></div><button type="button" onClick={props.onOpenCreateClass} className="rounded-xl bg-teal-700 px-5 py-3 text-sm font-bold text-white"><i className="fa-solid fa-plus mr-2" />Create Class</button></div></div>
      <div className="mx-auto grid max-w-7xl lg:grid-cols-[280px_1fr]">
        <aside className="border-b border-stone-200 bg-stone-50 p-5 lg:min-h-[calc(100vh-8rem)] lg:border-b-0 lg:border-r"><p className="mb-3 text-xs font-bold uppercase tracking-widest text-stone-500">Your Classes</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">{props.classes.map((group) => { const classEntries = props.entries.filter((entry) => entry.classId === group.id); return <button key={group.id} type="button" onClick={() => props.onSelectClass(group.id)} className={`rounded-2xl border p-4 text-left ${group.id === selected?.id ? 'border-teal-600 bg-white shadow-sm' : 'border-transparent hover:border-stone-300 hover:bg-white'}`}><span className="block font-black text-stone-950">{group.name}</span><span className="mt-1 block text-xs text-stone-500">{classEntries.length} people · {classEntries.filter((entry) => entry.invitation === 'Pending').length} pending</span></button>; })}</div></aside>
        <main className="p-5 sm:p-8"><div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between"><div><p className="text-sm font-semibold text-teal-700">Class access group</p><h2 className="text-3xl font-black tracking-tight text-stone-950">{selected?.name}</h2><p className="mt-1 text-sm text-stone-500">{selected?.note}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={props.onOpenCsv} className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700"><i className="fa-solid fa-file-csv mr-2 text-teal-700" />Import CSV</button><button type="button" onClick={props.onOpenInvite} className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white"><i className="fa-solid fa-envelope mr-2" />Add by email</button></div></div>
          <div className="my-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-stone-200 bg-white text-center"><div className="p-4"><strong className="block text-2xl text-stone-950">{active}</strong><span className="text-xs text-stone-500">Active members</span></div><div className="border-x border-stone-200 p-4"><strong className="block text-2xl text-stone-950">{pending}</strong><span className="text-xs text-stone-500">Pending</span></div><div className="p-4"><strong className="block text-2xl text-stone-950">{entries.length}</strong><span className="text-xs text-stone-500">Total history</span></div></div>
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm"><div className="border-b border-stone-200 px-5 py-4"><h3 className="font-black text-stone-950">People and Invitations</h3><p className="mt-1 text-xs text-stone-500">Invitation history remains visible after redemption or revocation.</p></div><div className="divide-y divide-stone-100">{entries.map((entry) => <div key={entry.id} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-stone-950">{entry.studentName ?? entry.email}</p><InvitationBadge status={entry.invitation} />{entry.membership === 'Inactive' && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Membership inactive</span>}</div>{entry.studentName && <p className="mt-1 text-sm text-stone-500">{entry.email}</p>}<p className="mt-1 text-xs text-stone-400">{entry.changed}</p></div><EntryActions entry={entry} props={props} /></div>)}</div></div>
        </main>
      </div>
    </section>
  );
}

function OperationsQueue(props: PrototypeProps) {
  const pending = props.entries.filter((entry) => entry.invitation === 'Pending');
  const attention = props.entries.filter((entry) => entry.invitation === 'Expired' || entry.invitation === 'Revoked' || entry.membership === 'Inactive');
  const members = props.entries.filter((entry) => entry.membership === 'Active');
  const className = (id: string) => props.classes.find((group) => group.id === id)?.name ?? id;
  const queue = [{ title: 'Needs attention', note: 'Expired, revoked, or inactive', entries: attention, tone: 'border-orange-300 bg-orange-50' }, { title: 'Awaiting response', note: 'Current pending Invitations', entries: pending, tone: 'border-blue-300 bg-blue-50' }, { title: 'Active access', note: 'Redeemed Class Memberships', entries: members, tone: 'border-emerald-300 bg-emerald-50' }];
  return (
    <section className="-mx-4 -my-8 min-h-[calc(100vh-4rem)] bg-slate-950 px-4 py-7 text-white sm:-mx-6 sm:px-7 lg:-mx-8 lg:px-10"><div className="mx-auto max-w-7xl"><header className="flex flex-col gap-5 border-b border-slate-700 pb-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">Prototype B · Status-first</p><h1 className="mt-2 text-3xl font-black">Invitation operations</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Work across Classes by lifecycle state. Class context travels with every person.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={props.onOpenCreateClass} className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-bold">New Class</button><button type="button" onClick={props.onOpenCsv} className="rounded-xl border border-slate-600 px-4 py-2.5 text-sm font-bold">Import CSV</button><button type="button" onClick={props.onOpenInvite} className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-black text-slate-950">Invite one</button></div></header>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{queue.map((column) => <section key={column.title} className="rounded-2xl bg-slate-900 p-3"><div className="flex items-start justify-between px-2 py-3"><div><h2 className="font-black">{column.title}</h2><p className="mt-1 text-xs text-slate-400">{column.note}</p></div><span className="rounded-full bg-slate-700 px-2.5 py-1 text-xs font-bold">{column.entries.length}</span></div><div className="space-y-3">{column.entries.map((entry) => <article key={entry.id} className={`rounded-xl border p-4 text-slate-950 ${column.tone}`}><p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{className(entry.classId)}</p><h3 className="mt-1 font-black">{entry.studentName ?? entry.email}</h3>{entry.studentName && <p className="mt-1 truncate text-xs text-slate-600">{entry.email}</p>}<div className="mt-3 flex items-center justify-between gap-3"><InvitationBadge status={entry.invitation} /><EntryActions entry={entry} props={props} /></div><p className="mt-3 border-t border-black/10 pt-3 text-xs text-slate-500">{entry.changed}</p></article>)}</div></section>)}</div>
      <aside className="mt-6 rounded-2xl border border-slate-700 bg-slate-900 p-5"><h2 className="text-sm font-black">Recent administrative activity</h2><div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">{props.activity.slice(0, 4).map((item) => <p key={item} className="rounded-lg bg-slate-800 px-3 py-2">{item}</p>)}</div></aside></div></section>
  );
}

function GuidedWorkflow(props: PrototypeProps) {
  const selected = props.classes.find((group) => group.id === props.selectedClassId) ?? props.classes[0];
  const entries = props.entries.filter((entry) => entry.classId === selected?.id);
  const active = entries.filter((entry) => entry.membership === 'Active');
  const outstanding = entries.filter((entry) => entry.membership !== 'Active');
  return (
    <section className="mx-auto max-w-5xl space-y-6"><header className="rounded-[2rem] bg-indigo-950 p-7 text-white shadow-xl sm:p-10"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">Prototype C · Guided</p><div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-black">Build a Class, one step at a time</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-indigo-200">A focused workspace keeps setup, invitation follow-up, and active access in one sequence.</p></div><button type="button" onClick={props.onOpenCreateClass} className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-indigo-950">Start another Class</button></div></header>
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Choose Class">{props.classes.map((group) => <button key={group.id} type="button" onClick={() => props.onSelectClass(group.id)} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold ${group.id === selected?.id ? 'bg-indigo-700 text-white' : 'border border-slate-300 bg-white text-slate-600'}`}>{group.name}</button>)}</nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]"><main className="space-y-4"><div className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-700 font-black text-white">1</span><div className="flex-1"><p className="text-xs font-black uppercase tracking-widest text-indigo-600">Class ready</p><h2 className="mt-1 text-2xl font-black text-slate-950">{selected?.name}</h2><p className="mt-1 text-sm text-slate-500">{selected?.note}. A Class controls access only; it has no assignments or grades.</p></div><i className="fa-solid fa-circle-check text-xl text-emerald-500" /></div></div>
        <div className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-700 font-black text-white">2</span><div className="flex-1"><p className="text-xs font-black uppercase tracking-widest text-indigo-600">Add people</p><h2 className="mt-1 text-xl font-black text-slate-950">Who should receive access?</h2><p className="mt-1 text-sm text-slate-500">Add one email now or review a CSV before anything is sent.</p><div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={props.onOpenInvite} className="rounded-2xl border-2 border-indigo-200 p-4 text-left"><i className="fa-solid fa-envelope text-indigo-600" /><strong className="mt-3 block">One email address</strong><span className="text-xs text-slate-500">Validate and send immediately</span></button><button type="button" onClick={props.onOpenCsv} className="rounded-2xl border-2 border-indigo-200 p-4 text-left"><i className="fa-solid fa-table-list text-indigo-600" /><strong className="mt-3 block">A CSV roster</strong><span className="text-xs text-slate-500">Preview every row first</span></button></div></div></div></div>
        <div className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-sm"><div className="flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-700 font-black text-white">3</span><div className="min-w-0 flex-1"><p className="text-xs font-black uppercase tracking-widest text-indigo-600">Follow up</p><h2 className="mt-1 text-xl font-black text-slate-950">{outstanding.length} Invitations need a decision</h2><div className="mt-4 space-y-3">{outstanding.map((entry) => <div key={entry.id} className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate font-bold text-slate-950">{entry.email}</p><p className="mt-1 text-xs text-slate-500">{entry.changed}</p></div><div className="flex items-center gap-3"><InvitationBadge status={entry.invitation} /><EntryActions entry={entry} props={props} /></div></div>)}</div></div></div></div></main>
        <aside className="space-y-4"><div className="rounded-3xl bg-amber-50 p-6"><p className="text-xs font-black uppercase tracking-widest text-amber-800">Active now</p><strong className="mt-2 block text-4xl text-slate-950">{active.length}</strong><p className="text-sm text-slate-600">Students with access through this Class</p><div className="mt-5 space-y-3">{active.map((entry) => <div key={entry.id} className="rounded-xl bg-white p-3"><p className="font-bold text-slate-950">{entry.studentName}</p><p className="text-xs text-slate-500">{entry.email}</p><div className="mt-2"><EntryActions entry={entry} props={props} /></div></div>)}</div></div><div className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="font-black text-slate-950">What changed?</h2><div className="mt-3 space-y-3">{props.activity.slice(0, 5).map((item) => <p key={item} className="border-l-2 border-indigo-200 pl-3 text-xs leading-relaxed text-slate-500">{item}</p>)}</div></div></aside></div>
    </section>
  );
}

function DialogShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">{eyebrow}</p><h2 className="mt-1 text-2xl font-black text-slate-950">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">×</button></div><div className="mt-6">{children}</div></section></div>;
}

function PrototypeSwitcher({ current, onReset }: { current: VariantKey; onReset: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentIndex = variants.findIndex((variant) => variant.key === current);
  const select = (offset: number) => { const next = variants[(currentIndex + offset + variants.length) % variants.length]; const updated = new URLSearchParams(searchParams); updated.set('variant', next.key); setSearchParams(updated, { replace: true }); };
  useEffect(() => { const handleKeyDown = (event: KeyboardEvent) => { const target = event.target as HTMLElement | null; if (target?.matches('input, textarea, select, [contenteditable="true"]')) return; if (event.key === 'ArrowLeft') select(-1); if (event.key === 'ArrowRight') select(1); }; window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown); });
  if (import.meta.env.PROD) return null;
  return <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 p-1.5 text-white shadow-2xl ring-2 ring-white"><button type="button" aria-label="Previous variant" onClick={() => select(-1)} className="flex h-9 w-9 items-center justify-center rounded-full">←</button><span className="min-w-44 px-3 text-center text-xs font-bold">{current} · {variants[currentIndex].name}</span><button type="button" aria-label="Next variant" onClick={() => select(1)} className="flex h-9 w-9 items-center justify-center rounded-full">→</button><button type="button" onClick={onReset} className="mr-1 rounded-full bg-white/15 px-3 py-2 text-xs font-bold">Reset</button></div>;
}

export function ClassInvitationManagementPrototype() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('variant')?.toUpperCase();
  const variant: VariantKey = requested === 'B' || requested === 'C' ? requested : 'A';
  const [classes, setClasses] = useState(initialClasses);
  const [entries, setEntries] = useState(initialEntries);
  const [selectedClassId, setSelectedClassId] = useState(initialClasses[0].id);
  const [dialog, setDialog] = useState<'class' | 'invite' | 'csv' | 'step-up' | null>(null);
  const [className, setClassName] = useState('');
  const [email, setEmail] = useState('');
  const initialActivity = ['Maya Joseph joined Spring Wellness with her existing Student identity.', 'Luis Santos Invitation revoked in Spring Wellness.', 'Grade 10 Health CSV import sent 4 Invitations.'];
  const [activity, setActivity] = useState(initialActivity);
  const record = (message: string) => setActivity((items) => [message, ...items]);
  const updateEntry = (id: string, update: Partial<RosterEntry>, message: string) => { setEntries((items) => items.map((entry) => entry.id === id ? { ...entry, ...update } : entry)); record(message); };
  const selectedName = classes.find((group) => group.id === selectedClassId)?.name ?? 'selected Class';
  const props: PrototypeProps = { classes, entries, selectedClassId, activity, onSelectClass: setSelectedClassId, onOpenCreateClass: () => setDialog('class'), onOpenInvite: () => setDialog('invite'), onOpenCsv: () => setDialog('csv'), onResend: (id) => updateEntry(id, { invitation: 'Pending', changed: 'Replacement sent just now · prior Invitation superseded' }, `Replacement Invitation sent for ${entries.find((entry) => entry.id === id)?.email}.`), onRevoke: (id) => updateEntry(id, { invitation: 'Revoked', changed: 'Revoked just now' }, `Pending Invitation revoked for ${entries.find((entry) => entry.id === id)?.email}.`), onDeactivate: (id) => updateEntry(id, { membership: 'Inactive', changed: 'Class Membership deactivated just now' }, `${entries.find((entry) => entry.id === id)?.studentName}'s Membership was deactivated; the Student and school-wide records remain.`), onReinvite: (id) => updateEntry(id, { invitation: 'Pending', changed: 'Fresh Invitation sent just now' }, `Fresh Invitation sent for ${entries.find((entry) => entry.id === id)?.email}; inactive Membership reactivates only after redemption.`) };
  const createClass = (event: FormEvent) => { event.preventDefault(); if (!className.trim()) return; const id = `class-${Date.now()}`; setClasses((items) => [...items, { id, name: className.trim(), note: 'New invitation group' }]); setSelectedClassId(id); record(`${className.trim()} Class created.`); setClassName(''); setDialog(null); };
  const inviteOne = (event: FormEvent) => { event.preventDefault(); if (!email.includes('@')) return; const normalized = email.trim().toLowerCase(); setEntries((items) => [...items, { id: `${Date.now()}`, classId: selectedClassId, email: normalized, invitation: 'Pending', membership: 'None', changed: 'Sent just now · expires in 7 days' }]); record(`Invitation sent to ${normalized} for ${selectedName}.`); setEmail(''); setDialog(null); };
  const confirmCsv = () => { setEntries((items) => [...items, { id: `sofia-${Date.now()}`, classId: selectedClassId, email: csvRows[0].email, invitation: 'Pending', membership: 'None', changed: 'Sent by CSV just now · expires in 7 days' }, { id: `noah-${Date.now()}`, classId: selectedClassId, email: csvRows[1].email, invitation: 'Pending', membership: 'None', changed: 'Sent by CSV just now · expires in 7 days' }]); record(`CSV import sent 2 Invitations for ${selectedName}; 3 rows were skipped.`); setDialog(null); };
  const reset = () => { setClasses(initialClasses); setEntries(initialEntries); setSelectedClassId(initialClasses[0].id); setActivity(initialActivity); setDialog(null); };
  return <>{variant === 'A' && <ClassWorkspace {...props} />}{variant === 'B' && <OperationsQueue {...props} />}{variant === 'C' && <GuidedWorkflow {...props} />}
    {dialog === 'class' && <DialogShell title="Create a Class" eyebrow="Access group" onClose={() => setDialog(null)}><form onSubmit={createClass}><label className="block text-sm font-bold text-slate-700">Class name<input autoFocus value={className} onChange={(event) => setClassName(event.target.value)} placeholder="Example: Grade 9 Wellness" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><p className="mt-3 text-sm text-slate-500">A Class groups Invitations and access. It does not create assignments, grades, attendance, or messaging.</p><button type="submit" className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Create empty Class</button></form></DialogShell>}
    {dialog === 'invite' && <DialogShell title={`Invite to ${selectedName}`} eyebrow="One Student email" onClose={() => setDialog(null)}><form onSubmit={inviteOne}><label className="block text-sm font-bold text-slate-700">Email address<input autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="student@example.edu" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-normal" /></label><div className="mt-4 rounded-xl bg-sky-50 p-4 text-sm text-sky-900"><strong>The system checks before sending:</strong> active Membership, current or historical email bindings, and existing Invitations. Ambiguous matches stop for staff review.</div><button type="submit" className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Validate and send Invitation</button></form></DialogShell>}
    {dialog === 'csv' && <DialogShell title={`Preview import for ${selectedName}`} eyebrow="Nothing sent yet" onClose={() => setDialog(null)}><div className="overflow-hidden rounded-xl border border-slate-200">{csvRows.map((row) => <div key={row.email} className="grid gap-2 border-b border-slate-100 p-3 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.email}</p><p className="text-xs text-slate-500">{row.detail}</p></div><span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${row.outcome === 'Ready' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{row.outcome}</span></div>)}</div><div className="mt-4 rounded-xl bg-slate-100 p-4 text-sm text-slate-700"><strong>2 ready to send</strong> · 3 skipped. Confirming a bulk send requires fresh password and TOTP.</div><button type="button" onClick={() => setDialog('step-up')} className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Continue with 2 valid rows</button></DialogShell>}
    {dialog === 'step-up' && <DialogShell title="Confirm bulk Invitation send" eyebrow="Sensitive action" onClose={() => setDialog('csv')}><p className="text-sm text-slate-600">Re-enter both factors. Any values work in this prototype.</p><div className="mt-4 space-y-3"><input type="password" placeholder="Password" className="w-full rounded-xl border border-slate-300 px-4 py-3" /><input inputMode="numeric" placeholder="6-digit authenticator code" className="w-full rounded-xl border border-slate-300 px-4 py-3" /></div><button type="button" onClick={confirmCsv} className="mt-6 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Confirm and send 2 Invitations</button></DialogShell>}
    <PrototypeSwitcher current={variant} onReset={reset} /></>;
}
