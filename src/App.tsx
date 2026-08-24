import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SchoolConfigurationEditorPrototype } from './features/admin/SchoolConfigurationEditorPrototype';
import { StaffHomePage } from './features/staff/StaffHomePage';
import { StaffSignInPage } from './features/staff/StaffSignInPage';
import {
  InvitationRedemptionPage,
  StudentHomePage,
} from './features/student-access/StudentAccessPages';

function RetiredPrototypePage() {
  return (
    <main className="min-h-full bg-slate-950 px-6 py-20 text-slate-100">
      <section className="mx-auto max-w-2xl border-l-4 border-amber-400 bg-slate-900 p-8 shadow-2xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
          Prototype retired
        </p>
        <h1 className="mt-4 text-4xl font-black tracking-tight">
          Student data entry is disabled.
        </h1>
        <p className="mt-5 text-lg leading-8 text-slate-300">
          This prototype has no production authority and accepts no Student
          information. Only synthetic, local-only interface exploration is
          permitted.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <BrowserRouter
      basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}
    >
      <Routes>
        <Route path="/staff/sign-in" element={<StaffSignInPage />} />
        <Route path="/staff" element={<StaffHomePage />} />
        <Route
          path="/student/invitation"
          element={<InvitationRedemptionPage />}
        />
        <Route path="/student" element={<StudentHomePage />} />
        <Route
          path="/prototype/school-configuration"
          element={<SchoolConfigurationEditorPrototype />}
        />
        <Route path="*" element={<RetiredPrototypePage />} />
      </Routes>
    </BrowserRouter>
  );
}
