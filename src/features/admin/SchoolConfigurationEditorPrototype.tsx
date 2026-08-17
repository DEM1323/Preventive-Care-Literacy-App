import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

// PROTOTYPE: Three UI models for school configuration, switchable via ?variant= on /prototype/school-configuration.

type VariantKey = 'A' | 'B' | 'C' | 'D';
type ResourceKey = 'branding' | 'modules' | 'intake' | 'translations';
type PreviewWidth = 'desktop' | 'mobile';
type PreviewScreen = 'home' | 'module' | 'intake';
type TranslationState = 'Reviewed' | 'Stale' | 'Generated' | 'Missing';
type Language = 'Spanish' | 'Portuguese' | 'French' | 'Haitian Creole';

interface DraftState {
  activeRelease: number;
  hasChanges: boolean;
  schoolName: string;
  shortName: string;
  moduleTitle: string;
  moduleSummary: string;
  intakeQuestion: string;
  primaryColor: string;
  contrastPasses: boolean;
  translations: Record<Language, TranslationState>;
  lastAction: string;
}

interface PrototypeActions {
  edit: (field: 'schoolName' | 'moduleTitle' | 'moduleSummary' | 'intakeQuestion', value: string) => void;
  setColor: (color: string) => void;
  generate: (language: Language) => void;
  editTranslation: (language: Language) => void;
  review: (language: Language) => void;
  publish: () => void;
}

interface VariantProps {
  draft: DraftState;
  actions: PrototypeActions;
  resource: ResourceKey;
  setResource: (resource: ResourceKey) => void;
  previewLanguage: Language | 'English';
  setPreviewLanguage: (language: Language | 'English') => void;
  previewWidth: PreviewWidth;
  setPreviewWidth: (width: PreviewWidth) => void;
  blockers: number;
}

const variants: Array<{ key: VariantKey; name: string }> = [
  { key: 'A', name: 'Release cockpit' },
  { key: 'B', name: 'Edit in preview' },
  { key: 'C', name: 'Guided publication' },
  { key: 'D', name: 'Chosen hybrid' },
];

const languages: Language[] = ['Spanish', 'Portuguese', 'French', 'Haitian Creole'];

const initialDraft: DraftState = {
  activeRelease: 7,
  hasChanges: true,
  schoolName: 'Roosevelt High School',
  shortName: 'RHS',
  moduleTitle: 'Everyday Preventive Care',
  moduleSummary: 'Small actions that help you stay healthy and know when to ask for support.',
  intakeQuestion: 'Do you have any health needs the school nurse should know about?',
  primaryColor: '#075985',
  contrastPasses: true,
  translations: {
    Spanish: 'Reviewed',
    Portuguese: 'Stale',
    French: 'Generated',
    'Haitian Creole': 'Missing',
  },
  lastAction: 'Draft autosaved 2 minutes ago',
};

const resourceLabels: Record<ResourceKey, { label: string; detail: string; icon: string }> = {
  branding: { label: 'Branding', detail: 'Names, marks, and theme', icon: 'fa-palette' },
  modules: { label: 'Learning Modules', detail: '3 active modules', icon: 'fa-book-open' },
  intake: { label: 'Intake Form', detail: '4 sections, 12 fields', icon: 'fa-clipboard-list' },
  translations: { label: 'Managed Translations', detail: '3 need attention', icon: 'fa-language' },
};

function statusTone(status: TranslationState) {
  if (status === 'Reviewed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'Stale') return 'bg-amber-100 text-amber-900';
  if (status === 'Generated') return 'bg-sky-100 text-sky-800';
  return 'bg-rose-100 text-rose-800';
}

function TranslationBadge({ status }: { status: TranslationState }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${statusTone(status)}`}>{status}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-extrabold text-slate-800">{label}</span>
      {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

function TranslationRows({ draft, actions, compact = false }: Pick<VariantProps, 'draft' | 'actions'> & { compact?: boolean }) {
  return (
    <div className="divide-y divide-slate-200">
      {languages.map((language) => {
        const status = draft.translations[language];
        return (
          <div key={language} className={`grid gap-3 ${compact ? 'py-2.5' : 'py-4'}`}>
            <div className="flex items-center justify-between gap-3"><div>
              <p className="text-sm font-bold text-slate-900">{language}</p>
              {!compact && <p className="mt-0.5 text-xs text-slate-500">Source revision 12 · whole release</p>}
            </div>
            <div className="flex items-center gap-2">
              <TranslationBadge status={status} />
              {status === 'Missing' || status === 'Stale' ? (
                <button type="button" onClick={() => actions.generate(language)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-sky-500">Generate</button>
              ) : status === 'Generated' ? (
                <button type="button" onClick={() => actions.review(language)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white">Review</button>
              ) : (
                <button type="button" onClick={() => actions.generate(language)} className="px-2 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-900">Regenerate</button>
              )}
            </div></div>
            {!compact && status !== 'Missing' && <textarea aria-label={`${language} generated translation`} defaultValue={language === 'Spanish' ? 'Cuidado preventivo cotidiano' : language === 'Portuguese' ? 'Cuidados preventivos diários' : language === 'French' ? 'Soins préventifs au quotidien' : 'Swen prevantif chak jou'} onChange={() => actions.editTranslation(language)} rows={2} className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-sky-600 focus:bg-white" />}
          </div>
        );
      })}
    </div>
  );
}

function StudentPreview({ draft, language, width, screen = 'module' }: { draft: DraftState; language: Language | 'English'; width: PreviewWidth; screen?: PreviewScreen }) {
  const [syntheticAnswer, setSyntheticAnswer] = useState<'No' | 'Yes'>('Yes');
  const translatedTitle: Record<Language, string> = {
    Spanish: 'Cuidado preventivo cotidiano',
    Portuguese: 'Cuidados preventivos diários',
    French: 'Soins préventifs au quotidien',
    'Haitian Creole': 'Swen prevantif chak jou',
  };
  const title = language === 'English' ? draft.moduleTitle : translatedTitle[language];
  const translationState = language === 'English' ? null : draft.translations[language];
  return (
    <div className={`mx-auto overflow-hidden rounded-[1.75rem] border-[6px] border-slate-900 bg-white shadow-2xl transition-all ${width === 'mobile' ? 'max-w-[360px]' : 'max-w-3xl'}`}>
      <div className="flex items-center justify-between px-5 py-3 text-white" style={{ background: draft.primaryColor }}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-sm font-black" style={{ color: draft.primaryColor }}>{draft.shortName}</span>
          <div><p className="text-sm font-black">{draft.schoolName}</p><p className="text-[10px] text-white/75">Student preview · synthetic data</p></div>
        </div>
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">{language}</span>
      </div>
      <div className={`bg-slate-50 p-5 ${width === 'desktop' ? 'sm:p-8' : ''}`}>
        {translationState && translationState !== 'Reviewed' && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">Previewing {translationState.toLowerCase()} draft translation. Students still see the active release.</div>
        )}
        {screen === 'home' && <div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Your school experience</p><h3 className={`mt-2 font-black tracking-tight text-slate-950 ${width === 'mobile' ? 'text-2xl' : 'text-3xl'}`}>Welcome to {draft.schoolName}</h3><p className="mt-3 text-sm leading-6 text-slate-600">Continue learning or review your next preventive-care topic.</p><div className={`mt-6 grid gap-3 ${width === 'desktop' ? 'sm:grid-cols-2' : ''}`}><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-emerald-700">In progress</p><p className="mt-2 font-black text-slate-950">{title}</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 bg-emerald-500" /></div></div><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase text-sky-700">Up next</p><p className="mt-2 font-black text-slate-950">Talking with your care team</p><p className="mt-3 text-xs text-slate-500">Knowledge · Skills · Application</p></div></div></div>}
        {screen === 'module' && <><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Knowledge · Skills · Application</p><h3 className={`mt-2 font-black tracking-tight text-slate-950 ${width === 'mobile' ? 'text-2xl' : 'text-3xl'}`}>{title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{draft.moduleSummary}</p><div className={`mt-6 grid gap-3 ${width === 'desktop' ? 'sm:grid-cols-3' : ''}`}>{['Knowledge', 'Skills', 'Application'].map((section, index) => <div key={section} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-xs font-black text-sky-800">{index + 1}</span><p className="mt-3 font-black text-slate-900">{section}</p><p className="mt-1 text-xs leading-5 text-slate-500">{index === 0 ? 'Learn the essentials.' : index === 1 ? 'Practice an “I can” skill.' : 'Try a guided next step.'}</p></div>)}</div></>}
        {screen === 'intake' && <div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Health intake · synthetic answers</p><h3 className={`mt-2 font-black tracking-tight text-slate-950 ${width === 'mobile' ? 'text-2xl' : 'text-3xl'}`}>Health needs</h3><p className="mt-2 text-sm text-slate-500">Preview visibility rules without loading a Student's Intake Record.</p><div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50 p-4"><p className="text-sm font-bold text-slate-900">{draft.intakeQuestion}</p><div className="mt-3 flex gap-2">{(['No', 'Yes'] as const).map((answer) => <button type="button" key={answer} onClick={() => setSyntheticAnswer(answer)} className={`rounded-full px-4 py-2 text-xs font-bold ${syntheticAnswer === answer ? 'bg-sky-800 text-white' : 'bg-white text-slate-600'}`}>{answer}</button>)}</div>{syntheticAnswer === 'Yes' && <div className="mt-3 rounded-xl border border-sky-200 bg-white p-3 text-xs text-slate-600"><strong className="block text-slate-900">Follow-up revealed by stable code “yes”</strong>Tell us what support you may need at school.</div>}</div></div>}
      </div>
    </div>
  );
}

function PublishButton({ blockers, hasChanges, onPublish, className = '' }: { blockers: number; hasChanges: boolean; onPublish: () => void; className?: string }) {
  return (
    <button type="button" disabled={blockers > 0 || !hasChanges} onClick={onPublish} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${className}`}>
      {!hasChanges ? 'Release is current' : blockers > 0 ? `${blockers} blockers to publish` : 'Publish release'}
    </button>
  );
}

function PreviewOverlay({ draft, language, setLanguage, width, setWidth, onClose }: { draft: DraftState; language: Language | 'English'; setLanguage: (language: Language | 'English') => void; width: PreviewWidth; setWidth: (width: PreviewWidth) => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm sm:p-7"><div className="mx-auto max-w-5xl"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-white"><div><p className="text-xs font-black uppercase tracking-widest text-sky-300">Exact release candidate</p><p className="mt-1 text-sm text-slate-300">Access-controlled preview with synthetic answers</p></div><div className="flex items-center gap-2"><select value={language} onChange={(event) => setLanguage(event.target.value as Language | 'English')} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-900"><option>English</option>{languages.map((item) => <option key={item}>{item}</option>)}</select><button type="button" onClick={() => setWidth(width === 'desktop' ? 'mobile' : 'desktop')} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-900">{width}</button><button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl" aria-label="Close preview">×</button></div></div><StudentPreview draft={draft} language={language} width={width} /></div></div>;
}

function ResourceEditor({ resource, draft, actions }: Pick<VariantProps, 'resource' | 'draft' | 'actions'>) {
  if (resource === 'branding') {
    return (
      <div className="space-y-6">
        <Field label="School display name"><input value={draft.schoolName} onChange={(event) => actions.edit('schoolName', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-600" /></Field>
        <Field label="Primary color" hint="Status colors remain product-owned"><div className="flex items-center gap-3"><input type="color" value={draft.primaryColor} onChange={(event) => actions.setColor(event.target.value)} className="h-12 w-16 rounded-lg border border-slate-300 bg-white p-1" /><input value={draft.primaryColor} onChange={(event) => actions.setColor(event.target.value)} className="w-32 rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm" /><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${draft.contrastPasses ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{draft.contrastPasses ? 'AA contrast passes' : 'Contrast blocks publish'}</span></div></Field>
        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-6 text-center"><i className="fa-regular fa-image text-2xl text-slate-400" /><p className="mt-2 text-sm font-bold text-slate-700">School mark</p><p className="text-xs text-slate-500">PNG or SVG · validated before publication</p></div>
      </div>
    );
  }
  if (resource === 'modules') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-3"><div><p className="text-sm font-black text-slate-900">Module 1 of 3</p><p className="text-xs text-slate-500">Stable ID: mod_preventive_basics</p></div><span className="text-xs font-bold text-slate-500">Drag to reorder</span></div>
        <Field label="English title" hint="Canonical source"><input value={draft.moduleTitle} onChange={(event) => actions.edit('moduleTitle', event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-600" /></Field>
        <Field label="English summary"><textarea value={draft.moduleSummary} onChange={(event) => actions.edit('moduleSummary', event.target.value)} rows={3} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-600" /></Field>
        <div className="grid gap-3 sm:grid-cols-3">{['Knowledge · 4 items', 'Skills · 3 items', 'Application · 2 steps'].map((item) => <button type="button" key={item} className="rounded-xl border border-slate-200 p-4 text-left text-sm font-black text-slate-800 hover:border-sky-500">{item}<span className="mt-2 block text-xs font-medium text-slate-500">Open section →</span></button>)}</div>
      </div>
    );
  }
  if (resource === 'intake') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900"><strong>Visibility preview:</strong> Synthetic answer “Yes” reveals this follow-up. No Student record is used.</div>
        <div className="rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Section 2 · Health needs</p><p className="mt-1 text-xs text-slate-400">Stable field ID: fld_health_needs</p></div><span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-bold text-rose-800">Required</span></div><Field label="English question"><textarea value={draft.intakeQuestion} onChange={(event) => actions.edit('intakeQuestion', event.target.value)} rows={3} className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-600" /></Field><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-100 p-3 text-sm font-bold">No <span className="block text-xs font-medium text-slate-500">Code: no</span></div><div className="rounded-xl bg-slate-100 p-3 text-sm font-bold">Yes <span className="block text-xs font-medium text-slate-500">Code: yes</span></div></div></div>
      </div>
    );
  }
  return <TranslationRows draft={draft} actions={actions} />;
}

function ReleaseCockpit(props: VariantProps) {
  const [showPreview, setShowPreview] = useState(false);
  const selected = resourceLabels[props.resource];
  return (
    <div className="min-h-screen bg-[#f3f1ea] text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-800 font-black text-white">R</span><div><p className="font-black">Roosevelt workspace</p><p className="text-xs text-slate-500">School configuration</p></div></div><div className="flex items-center gap-3"><span className="hidden rounded-full bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-900 sm:inline">{props.draft.hasChanges ? `Draft differs from release ${props.draft.activeRelease}` : `Release ${props.draft.activeRelease} is current`}</span><PublishButton blockers={props.blockers} hasChanges={props.draft.hasChanges} onPublish={props.actions.publish} className="bg-sky-800 text-white" /></div></div></header>
      <div className="mx-auto grid max-w-[1500px] lg:grid-cols-[260px_minmax(0,1fr)_310px]">
        <aside className="border-b border-slate-800 bg-slate-950 p-4 text-white lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r">
          <p className="px-3 pb-3 pt-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Release contents</p>
          <nav className="grid gap-1 sm:grid-cols-4 lg:grid-cols-1">{(Object.keys(resourceLabels) as ResourceKey[]).map((key) => { const item = resourceLabels[key]; return <button key={key} type="button" onClick={() => props.setResource(key)} className={`rounded-xl px-3 py-3 text-left ${props.resource === key ? 'bg-sky-700 text-white' : 'text-slate-300 hover:bg-slate-900'}`}><span className="flex items-center gap-3"><i className={`fa-solid ${item.icon} w-5 text-center`} /><span><strong className="block text-sm">{item.label}</strong><small className={`block ${props.resource === key ? 'text-sky-100' : 'text-slate-500'}`}>{item.detail}</small></span></span></button>; })}</nav>
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs font-black text-slate-200">Active release {props.draft.activeRelease}</p><p className="mt-1 text-xs leading-5 text-slate-500">Published Aug 10 by Elena Ruiz. Draft changes are not visible to Students.</p><button type="button" className="mt-3 text-xs font-bold text-sky-400">Compare with draft →</button></div>
        </aside>
        <main className="min-w-0 p-5 sm:p-8"><div className="mb-6 flex items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Editing shared draft</p><h1 className="mt-1 text-3xl font-black tracking-tight">{selected.label}</h1><p className="mt-1 text-sm text-slate-500">{selected.detail} · Autosaved</p></div><button type="button" onClick={() => setShowPreview(true)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold">Quick preview</button></div><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><ResourceEditor resource={props.resource} draft={props.draft} actions={props.actions} /></section></main>
        <aside className="border-t border-slate-200 bg-white p-5 lg:border-l lg:border-t-0 lg:p-6"><div className="sticky top-5"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Release readiness</p><div className="mt-3 rounded-2xl bg-slate-950 p-5 text-white"><div className="flex items-baseline justify-between"><strong className="text-4xl">{props.blockers}</strong><span className="text-xs font-bold text-rose-300">blocking</span></div><p className="mt-2 text-xs leading-5 text-slate-400">Every language must be complete and reviewed. Contrast must pass.</p></div><div className="mt-5"><TranslationRows draft={props.draft} actions={props.actions} compact /></div><div className="mt-5 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>1 warning:</strong> Haitian Creole summary is longer than the recommended mobile length.</div></div></aside>
      </div>
      {showPreview && <PreviewOverlay draft={props.draft} language={props.previewLanguage} setLanguage={props.setPreviewLanguage} width={props.previewWidth} setWidth={props.setPreviewWidth} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

function EditInPreview(props: VariantProps) {
  return (
    <div className="min-h-screen bg-[#dce8e5] text-slate-950">
      <header className="border-b border-emerald-950/15 bg-[#f6fbf8] px-4 py-4"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-800">Live release studio</p><h1 className="text-xl font-black">See the Student experience while you edit</h1></div><div className="flex items-center gap-2"><select value={props.previewLanguage} onChange={(event) => props.setPreviewLanguage(event.target.value as Language | 'English')} className="rounded-xl border border-emerald-950/20 bg-white px-3 py-2 text-sm font-bold"><option>English</option>{languages.map((language) => <option key={language}>{language}</option>)}</select><button type="button" onClick={() => props.setPreviewWidth(props.previewWidth === 'desktop' ? 'mobile' : 'desktop')} className="rounded-xl border border-emerald-950/20 bg-white px-3 py-2 text-sm font-bold"><i className={`fa-solid ${props.previewWidth === 'desktop' ? 'fa-mobile-screen' : 'fa-desktop'} mr-2`} />{props.previewWidth}</button><PublishButton blockers={props.blockers} hasChanges={props.draft.hasChanges} onPublish={props.actions.publish} className="bg-emerald-950 text-white" /></div></div></header>
      <div className="mx-auto grid max-w-[1500px] xl:grid-cols-[84px_minmax(0,1fr)_390px]">
        <nav className="flex gap-2 overflow-x-auto border-b border-emerald-950/15 bg-emerald-950 p-3 text-white xl:min-h-[calc(100vh-74px)] xl:flex-col xl:border-b-0 xl:border-r">{(Object.keys(resourceLabels) as ResourceKey[]).map((key) => { const item = resourceLabels[key]; return <button key={key} type="button" title={item.label} onClick={() => props.setResource(key)} className={`flex h-14 min-w-14 flex-col items-center justify-center rounded-xl text-[10px] font-bold ${props.resource === key ? 'bg-lime-300 text-emerald-950' : 'text-emerald-100 hover:bg-white/10'}`}><i className={`fa-solid ${item.icon} mb-1 text-lg`} />{key === 'translations' ? 'Locales' : item.label.split(' ')[0]}</button>; })}</nav>
        <main className="min-w-0 p-5 sm:p-8"><div className="mb-5 flex items-center justify-between"><div><p className="text-sm font-black text-emerald-950">Exact draft candidate</p><p className="text-xs text-emerald-900/60">Synthetic Student data only · not a Student route</p></div><span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold text-emerald-950">Release {props.draft.activeRelease + 1} candidate</span></div><StudentPreview draft={props.draft} language={props.previewLanguage} width={props.previewWidth} /></main>
        <aside className="border-t border-emerald-950/15 bg-[#f6fbf8] p-5 xl:border-l xl:border-t-0 xl:p-7"><p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Selected layer</p><h2 className="mt-1 text-2xl font-black">{resourceLabels[props.resource].label}</h2><p className="mt-1 text-xs leading-5 text-slate-500">Changes autosave to the shared draft and update this preview. Students remain on release {props.draft.activeRelease}.</p><div className="mt-6"><ResourceEditor resource={props.resource} draft={props.draft} actions={props.actions} /></div></aside>
      </div>
    </div>
  );
}

function GuidedPublication(props: VariantProps) {
  const [showPreview, setShowPreview] = useState(false);
  const stages: Array<{ key: ResourceKey; step: string; label: string; status: string }> = [
    { key: 'branding', step: '01', label: 'Shape', status: props.draft.contrastPasses ? 'Ready' : 'Blocked' },
    { key: 'modules', step: '02', label: 'Teach', status: props.draft.moduleTitle.trim() ? 'Ready' : 'Blocked' },
    { key: 'intake', step: '03', label: 'Ask', status: props.draft.intakeQuestion.trim() ? 'Ready' : 'Blocked' },
    { key: 'translations', step: '04', label: 'Translate', status: props.blockers === 0 ? 'Ready' : `${props.blockers} left` },
  ];
  return (
    <div className="min-h-screen bg-[#fff8e8] px-4 py-6 text-[#29231d] sm:px-7 lg:px-10">
      <div className="mx-auto max-w-7xl"><header className="flex flex-col gap-5 border-b-2 border-[#29231d] pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="font-serif text-sm italic text-[#8a4b28]">Roosevelt High School</p><h1 className="mt-1 max-w-3xl font-serif text-4xl font-black leading-none sm:text-5xl">Prepare the next school experience.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#6f6358]">One guided path from authored source to an atomic, multilingual School Configuration Release.</p></div><div className="rounded-2xl border-2 border-[#29231d] bg-white px-5 py-4 shadow-[5px_5px_0_#29231d]"><p className="text-xs font-black uppercase tracking-widest">Published now</p><p className="mt-1 font-serif text-2xl font-black">Release {props.draft.activeRelease}</p></div></header>
        <nav className="my-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stages.map((stage) => <button key={stage.key} type="button" onClick={() => props.setResource(stage.key)} className={`flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition ${props.resource === stage.key ? 'border-[#29231d] bg-[#f3c969] shadow-[4px_4px_0_#29231d]' : 'border-[#d8cab5] bg-white hover:border-[#29231d]'}`}><span className="font-serif text-2xl font-black">{stage.step}</span><span><strong className="block">{stage.label}</strong><small className={`font-bold ${stage.status === 'Ready' ? 'text-emerald-700' : 'text-rose-700'}`}>{stage.status}</small></span></button>)}</nav>
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_330px]"><main className="rounded-[2rem] border-2 border-[#29231d] bg-white p-6 shadow-[7px_7px_0_#d99d6c] sm:p-9"><div className="mb-7 flex flex-col gap-4 border-b border-[#d8cab5] pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-[#8a4b28]">Step {stages.find((stage) => stage.key === props.resource)?.step}</p><h2 className="mt-1 font-serif text-3xl font-black">{resourceLabels[props.resource].label}</h2></div><button type="button" onClick={() => setShowPreview(true)} className="rounded-full border-2 border-[#29231d] px-4 py-2 text-xs font-black">Open candidate preview</button></div><ResourceEditor resource={props.resource} draft={props.draft} actions={props.actions} /><div className="mt-8 flex justify-end border-t border-[#d8cab5] pt-5">{props.resource !== 'translations' ? <button type="button" onClick={() => { const index = stages.findIndex((stage) => stage.key === props.resource); props.setResource(stages[Math.min(index + 1, stages.length - 1)].key); }} className="rounded-full bg-[#29231d] px-6 py-3 text-sm font-black text-white">Continue to next step →</button> : <PublishButton blockers={props.blockers} hasChanges={props.draft.hasChanges} onPublish={props.actions.publish} className="bg-[#29231d] text-white" />}</div></main>
          <aside className="space-y-5"><section className="rounded-[2rem] bg-[#29231d] p-6 text-white"><p className="text-xs font-black uppercase tracking-[0.2em] text-[#f3c969]">Publication checklist</p><div className="mt-5 space-y-4">{['Branding passes accessibility checks', 'Learning content has stable identities', 'Intake rules validate without cycles', 'Every translation is reviewed'].map((item, index) => { const done = index < 3 ? true : props.blockers === 0; return <div key={item} className="flex gap-3"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-400 text-emerald-950' : 'bg-rose-300 text-rose-950'}`}>{done ? '✓' : '!'}</span><p className="text-sm leading-5 text-[#eee5d9]">{item}</p></div>; })}</div><div className="mt-6 border-t border-white/20 pt-5"><p className="text-3xl font-black">{props.blockers}</p><p className="text-xs text-white/60">blocking checks remaining</p></div></section><section className="rounded-[2rem] border-2 border-[#d8cab5] bg-white p-6"><p className="text-xs font-black uppercase tracking-widest text-[#8a4b28]">What publication does</p><p className="mt-3 text-sm leading-6 text-[#6f6358]">Freezes this exact candidate and activates it atomically. It never edits release {props.draft.activeRelease} or mixes old and new resources.</p><button type="button" className="mt-4 text-sm font-black underline decoration-2 underline-offset-4">Compare with active release</button></section></aside></div>
      </div>{showPreview && <PreviewOverlay draft={props.draft} language={props.previewLanguage} setLanguage={props.setPreviewLanguage} width={props.previewWidth} setWidth={props.setPreviewWidth} onClose={() => setShowPreview(false)} />}
    </div>
  );
}

function ChosenHybrid(props: VariantProps) {
  const [inspectorTab, setInspectorTab] = useState<'edit' | 'readiness'>('edit');
  const [mobileSurface, setMobileSurface] = useState<'edit' | 'preview' | 'readiness'>('preview');
  const [previewScreen, setPreviewScreen] = useState<PreviewScreen>('module');
  const [publishStep, setPublishStep] = useState<'review' | 'step-up' | null>(null);
  const [changeDescription, setChangeDescription] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');

  useEffect(() => {
    if (props.resource === 'branding') setPreviewScreen('home');
    if (props.resource === 'modules') setPreviewScreen('module');
    if (props.resource === 'intake') setPreviewScreen('intake');
  }, [props.resource]);

  const chooseResource = (resource: ResourceKey) => {
    props.setResource(resource);
    setInspectorTab('edit');
    setMobileSurface('edit');
  };
  const chooseSurface = (surface: 'edit' | 'preview' | 'readiness') => {
    setMobileSurface(surface);
    if (surface !== 'preview') setInspectorTab(surface);
  };
  const confirmPublish = () => {
    props.actions.publish();
    setPublishStep(null);
    setChangeDescription('');
    setPassword('');
    setTotp('');
  };
  const publishDisabled = props.blockers > 0 || !props.draft.hasChanges;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
      <header className="sticky top-0 z-40 bg-emerald-700 px-4 py-3 text-white shadow-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-emerald-700 shadow"><i className="fa-solid fa-heart-pulse" /></span><div><h1 className="text-lg font-bold tracking-tight">Preventive Care Literacy</h1><p className="text-xs font-medium text-emerald-100">Roosevelt High School · Configuration</p></div></div>
          <div className="flex items-center gap-2"><span className={`rounded-full border px-3 py-2 text-xs font-bold ${props.blockers ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-emerald-500 bg-emerald-800 text-emerald-100'}`}>{props.blockers ? `${props.blockers} publication blockers` : 'Ready for review'}</span><button type="button" disabled={publishDisabled} onClick={() => setPublishStep('review')} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 shadow-lg transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">{props.draft.hasChanges ? 'Review to publish' : 'Release is current'}</button></div>
        </div>
      </header>

      <nav className="grid grid-cols-3 border-b border-slate-200 bg-white p-2 xl:hidden" aria-label="Configuration surface">
        {(['edit', 'preview', 'readiness'] as const).map((surface) => <button key={surface} type="button" onClick={() => chooseSurface(surface)} className={`rounded-lg px-3 py-2 text-xs font-bold capitalize ${mobileSurface === surface ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}>{surface}</button>)}
      </nav>

      <div className="mx-auto grid max-w-[1600px] xl:grid-cols-[96px_minmax(0,1fr)_400px]">
        <nav className={`${mobileSurface === 'edit' ? 'flex' : 'hidden'} gap-2 overflow-x-auto border-b border-slate-200 bg-white p-3 xl:flex xl:min-h-[calc(100vh-64px)] xl:flex-col xl:border-b-0 xl:border-r`} aria-label="Configuration resources">
          {(Object.keys(resourceLabels) as ResourceKey[]).map((key) => { const item = resourceLabels[key]; return <button key={key} type="button" title={item.label} onClick={() => chooseResource(key)} className={`flex h-16 min-w-16 flex-col items-center justify-center rounded-xl text-[10px] font-bold transition ${props.resource === key ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}><i className={`fa-solid ${item.icon} mb-1 text-lg`} />{key === 'translations' ? 'Locales' : item.label.split(' ')[0]}</button>; })}
        </nav>

        <main className={`${mobileSurface === 'preview' ? 'block' : 'hidden'} min-w-0 p-4 sm:p-7 xl:block`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-bold text-slate-900">Exact draft candidate</p><p className="text-xs text-slate-500">Preview follows the resource selected for editing.</p></div>
            <div className="flex flex-wrap items-center gap-2"><select value={props.previewLanguage} onChange={(event) => props.setPreviewLanguage(event.target.value as Language | 'English')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold"><option>English</option>{languages.map((language) => <option key={language}>{language}</option>)}</select><button type="button" onClick={() => props.setPreviewWidth(props.previewWidth === 'desktop' ? 'mobile' : 'desktop')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold">{props.previewWidth}</button></div>
          </div>
          <StudentPreview draft={props.draft} language={props.previewLanguage} width={props.previewWidth} screen={previewScreen} />
        </main>

        <aside className={`${mobileSurface === 'preview' ? 'hidden' : 'block'} border-t border-slate-200 bg-white p-5 xl:block xl:border-l xl:border-t-0 xl:p-7`}>
          <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => chooseSurface('edit')} className={`rounded-lg px-3 py-2 text-xs font-bold ${inspectorTab === 'edit' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>Edit selected</button>
            <button type="button" onClick={() => chooseSurface('readiness')} className={`rounded-lg px-3 py-2 text-xs font-bold ${inspectorTab === 'readiness' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>Release readiness · {props.blockers}</button>
          </div>
          {inspectorTab === 'edit' ? <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Selected resource</p><h2 className="mt-1 text-2xl font-bold text-slate-900">{resourceLabels[props.resource].label}</h2><p className="mt-1 text-xs leading-5 text-slate-500">Autosaves to the shared draft. Students remain on release {props.draft.activeRelease}.</p><div className="mt-6"><ResourceEditor resource={props.resource} draft={props.draft} actions={props.actions} /></div></div> : <div><div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-5 text-white shadow-lg"><p className="text-xs font-bold uppercase tracking-widest text-emerald-100">Release {props.draft.activeRelease + 1} candidate</p><div className="mt-3 flex items-end justify-between"><strong className="text-4xl">{props.blockers}</strong><span className="pb-1 text-xs text-emerald-100">blocking checks</span></div><p className="mt-3 text-xs leading-5 text-emerald-100">Warnings remain visible but do not prevent publication.</p></div><div className="mt-5 space-y-3">{['Branding contrast and assets', 'Learning Module structure', 'Intake visibility and references'].map((check) => <div key={check} className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-white p-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">✓</span><p className="text-sm font-bold">{check}</p></div>)}</div><div className="mt-5"><TranslationRows draft={props.draft} actions={props.actions} compact /></div><div className="mt-5 rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>1 non-blocking warning:</strong> Haitian Creole module summary may wrap to four lines on small screens.</div><button type="button" disabled={publishDisabled} onClick={() => setPublishStep('review')} className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">{props.draft.hasChanges ? props.blockers ? `Resolve ${props.blockers} blockers` : 'Review release and publish' : 'Release is current'}</button></div>}
        </aside>
      </div>

      {publishStep === 'review' && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-label="Review release" className="max-h-[95vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 sm:max-w-2xl sm:rounded-3xl sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Step 1 of 2</p><h2 className="mt-1 text-2xl font-bold">Review release {props.draft.activeRelease + 1}</h2></div><button type="button" onClick={() => setPublishStep(null)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100" aria-label="Close">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{['Branding · color updated', 'Learning Modules · 1 revised', 'Intake Form · unchanged', 'Managed Translations · 4 reviewed'].map((change) => <div key={change} className="rounded-xl border border-slate-200 p-4 text-sm font-bold">{change}</div>)}</div><Field label="Required change description" hint="Stored with the immutable release"><textarea value={changeDescription} onChange={(event) => setChangeDescription(event.target.value)} rows={3} placeholder="Why is this release being published?" className="mt-6 w-full rounded-xl border border-slate-300 px-4 py-3" /></Field><div className="mt-5 rounded-xl bg-sky-50 p-4 text-sm text-sky-900">Publication freezes this candidate and activates all selected revisions atomically. It does not overwrite release {props.draft.activeRelease}.</div><button type="button" disabled={!changeDescription.trim()} onClick={() => setPublishStep('step-up')} className="mt-6 w-full rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50">Continue to authentication</button></section></div>}

      {publishStep === 'step-up' && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-label="Confirm publication" className="w-full rounded-t-3xl bg-white p-6 sm:max-w-lg sm:rounded-3xl sm:p-8"><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Step 2 of 2 · Sensitive action</p><h2 className="mt-1 text-2xl font-bold">Confirm publication</h2><p className="mt-2 text-sm leading-6 text-slate-500">Your authentication is older than 15 minutes in this prototype. Re-enter both factors; any values work here.</p><div className="mt-5 space-y-3"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-xl border border-slate-300 px-4 py-3" /><input inputMode="numeric" value={totp} onChange={(event) => setTotp(event.target.value)} placeholder="6-digit authenticator code" className="w-full rounded-xl border border-slate-300 px-4 py-3" /></div><div className="mt-6 flex gap-3"><button type="button" onClick={() => setPublishStep('review')} className="flex-1 rounded-xl border border-slate-300 px-4 py-3 font-bold">Back</button><button type="button" disabled={!password || !totp} onClick={confirmPublish} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50">Publish atomically</button></div></section></div>}
    </div>
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
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') select(-1);
      if (event.key === 'ArrowRight') select(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
  if (import.meta.env.PROD) return null;
  return <div className="fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 p-1.5 text-white shadow-2xl ring-2 ring-white"><button type="button" aria-label="Previous variant" onClick={() => select(-1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10">←</button><span className="min-w-0 px-2 text-center text-xs font-bold sm:min-w-44">{current} · {variants[currentIndex].name}</span><button type="button" aria-label="Next variant" onClick={() => select(1)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10">→</button><button type="button" onClick={onReset} className="mr-1 hidden rounded-full bg-white/15 px-3 py-2 text-xs font-bold sm:block">Reset</button></div>;
}

function StateMonitor({ draft, blockers }: { draft: DraftState; blockers: number }) {
  if (import.meta.env.PROD) return null;
  return <div className="fixed bottom-4 left-4 z-[90] hidden max-w-xs rounded-xl bg-white/95 p-3 text-[11px] text-slate-700 shadow-xl ring-1 ring-slate-300 backdrop-blur lg:block"><p className="font-black uppercase tracking-wider text-fuchsia-700">Prototype state</p><p className="mt-1"><strong>Active:</strong> release {draft.activeRelease} · <strong>Draft:</strong> {draft.hasChanges ? `${blockers} blockers` : 'no unpublished changes'}</p><p className="mt-1 text-slate-500">{draft.lastAction}</p></div>;
}

export function SchoolConfigurationEditorPrototype() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('variant')?.toUpperCase();
  const variant: VariantKey = requested === 'B' || requested === 'C' || requested === 'D' ? requested : 'A';
  const [draft, setDraft] = useState(initialDraft);
  const [resource, setResource] = useState<ResourceKey>('modules');
  const [previewLanguage, setPreviewLanguage] = useState<Language | 'English'>('Spanish');
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>('desktop');
  const translationBlockers = languages.filter((language) => draft.translations[language] !== 'Reviewed').length;
  const blockers = translationBlockers + (draft.contrastPasses ? 0 : 1) + (draft.moduleTitle.trim() ? 0 : 1) + (draft.intakeQuestion.trim() ? 0 : 1);
  const markSourceChanged = (state: DraftState) => ({ ...state.translations, Spanish: 'Stale', Portuguese: 'Stale', French: 'Stale', 'Haitian Creole': 'Stale' } as Record<Language, TranslationState>);
  const actions: PrototypeActions = {
    edit: (field, value) => setDraft((state) => ({ ...state, hasChanges: true, [field]: value, translations: markSourceChanged(state), lastAction: `Autosaved English ${field}; all Managed Translations are now stale` })),
    setColor: (color) => setDraft((state) => ({ ...state, hasChanges: true, primaryColor: color, contrastPasses: color.toLowerCase() !== '#ffffff' && color.toLowerCase() !== '#ffff00', lastAction: 'Autosaved branding color and reran contrast validation' })),
    generate: (language) => setDraft((state) => ({ ...state, hasChanges: true, translations: { ...state.translations, [language]: 'Generated' }, lastAction: `Generated a ${language} draft; human review is still required` })),
    editTranslation: (language) => setDraft((state) => ({ ...state, hasChanges: true, translations: { ...state.translations, [language]: 'Generated' }, lastAction: `Autosaved a human edit to the ${language} translation; review is still required` })),
    review: (language) => setDraft((state) => ({ ...state, hasChanges: true, translations: { ...state.translations, [language]: 'Reviewed' }, lastAction: `Marked the ${language} draft reviewed` })),
    publish: () => {
      if (blockers > 0) return;
      setDraft((state) => ({ ...state, activeRelease: state.activeRelease + 1, hasChanges: false, lastAction: `Published release ${state.activeRelease + 1} atomically; a fresh shared draft is ready` }));
    },
  };
  const props: VariantProps = { draft, actions, resource, setResource, previewLanguage, setPreviewLanguage, previewWidth, setPreviewWidth, blockers };
  return <>{variant === 'A' && <ReleaseCockpit {...props} />}{variant === 'B' && <EditInPreview {...props} />}{variant === 'C' && <GuidedPublication {...props} />}{variant === 'D' && <ChosenHybrid {...props} />}<StateMonitor draft={draft} blockers={blockers} /><PrototypeSwitcher current={variant} onReset={() => { setDraft(initialDraft); setResource('modules'); setPreviewLanguage('Spanish'); setPreviewWidth('desktop'); }} /></>;
}
