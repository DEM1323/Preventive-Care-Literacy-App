import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './context/AppStateContext';
import { IntakeSchemaProvider } from './context/IntakeSchemaContext';
import { LanguageProvider } from './context/LanguageContext';
import { ModulesProvider } from './context/ModulesContext';
import { ToastProvider } from './context/ToastContext';
import { Layout } from './components/organisms/Layout';
import { RequireAuth, RequireIntake } from './components/organisms/RequireAuth';
import { HeroPage } from './features/auth/HeroPage';
import { SignInPage } from './features/auth/SignInPage';
import { IntakeWizardPage } from './features/intake/IntakeWizardPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ModulePage } from './features/dashboard/ModulePage';
import { ProfilePage } from './features/profile/ProfilePage';
import { NurseDashboardPage } from './features/nurse/NurseDashboardPage';
import { SchoolConfigurationEditorPrototype } from './features/admin/SchoolConfigurationEditorPrototype';
import { useEffect } from 'react';
import { flushPendingSubmissions } from './utils/sheets';

function OnlineSync() {
  useEffect(() => {
    const sync = () => void flushPendingSubmissions();
    window.addEventListener('online', sync);
    sync();
    return () => window.removeEventListener('online', sync);
  }, []);
  return null;
}

export default function App() {
  return (
    <LanguageProvider>
      <AppStateProvider>
        <ModulesProvider>
          <IntakeSchemaProvider>
            <ToastProvider>
              <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
                <OnlineSync />
                <Routes>
                  <Route path="/prototype/school-configuration" element={<SchoolConfigurationEditorPrototype />} />
                  <Route element={<Layout />}>
                    <Route path="/" element={<HeroPage />} />
                    <Route path="/sign-in" element={<SignInPage />} />
                    <Route
                      path="/intake"
                      element={
                        <RequireAuth>
                          <IntakeWizardPage />
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/dashboard"
                      element={
                        <RequireAuth>
                          <RequireIntake>
                            <DashboardPage />
                          </RequireIntake>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/module/:id"
                      element={
                        <RequireAuth>
                          <RequireIntake>
                            <ModulePage />
                          </RequireIntake>
                        </RequireAuth>
                      }
                    />
                    <Route
                      path="/profile"
                      element={
                        <RequireAuth>
                          <RequireIntake>
                            <ProfilePage />
                          </RequireIntake>
                        </RequireAuth>
                      }
                    />
                    <Route path="/nurse" element={<NurseDashboardPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </ToastProvider>
          </IntakeSchemaProvider>
        </ModulesProvider>
      </AppStateProvider>
    </LanguageProvider>
  );
}
