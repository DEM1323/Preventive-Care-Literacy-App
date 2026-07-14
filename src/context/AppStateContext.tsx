import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { clearStudentSession, getStudentSession, isStudentSessionValid } from '../utils/studentSession';

interface User {
  name: string;
  email: string;
}

interface IntakeState {
  completed: boolean;
  lastUpdatedAt: string | null;
  version: number;
}

interface AppStateContextValue {
  isLoggedIn: boolean;
  user: User;
  intake: IntakeState;
  modulesProgress: Record<string, number[]>;
  earnedBadges: string[];
  login: (name: string, email: string) => void;
  logout: () => void;
  markIntakeSubmitted: (version?: number) => void;
  syncIntakeOnLogin: (hasSubmission: boolean, version?: number) => void;
  toggleSkill: (moduleId: string, index: number, checked: boolean) => void;
  getModuleProgress: (moduleId: string, totalSkills: number) => number;
  awardBadge: (moduleId: string) => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useLocalStorage('prevcare_isLoggedIn', false);
  const [user, setUser] = useLocalStorage<User>('prevcare_user', { name: '', email: '' });
  const [intake, setIntake] = useLocalStorage<IntakeState>('prevcare_intake', {
    completed: false,
    lastUpdatedAt: null,
    version: 0,
  });
  const [modulesProgress, setModulesProgress] = useLocalStorage<Record<string, number[]>>(
    'prevcare_modulesProgress',
    {}
  );
  const [earnedBadges, setEarnedBadges] = useLocalStorage<string[]>('prevcare_earnedBadges', []);

  useEffect(() => {
    const session = getStudentSession();
    if (!session || !isLoggedIn) return;
    if (!session.hasSubmission && intake.completed) {
      setIntake({
        completed: false,
        lastUpdatedAt: null,
        version: 0,
      });
    }
  }, [isLoggedIn, intake.completed, setIntake]);

  const login = useCallback(
    (name: string, email: string) => {
      setIsLoggedIn(true);
      setUser({ name: name || email.split('@')[0], email });
    },
    [setIsLoggedIn, setUser]
  );

  const logout = useCallback(() => {
    setIsLoggedIn(false);
    clearStudentSession();
  }, [setIsLoggedIn]);

  const markIntakeSubmitted = useCallback(
    (version?: number) => {
      setIntake({
        completed: true,
        lastUpdatedAt: new Date().toISOString(),
        version: version ?? intake.version + 1,
      });
    },
    [setIntake, intake.version]
  );

  const syncIntakeOnLogin = useCallback(
    (hasSubmission: boolean, version?: number) => {
      if (hasSubmission) {
        setIntake({
          completed: true,
          lastUpdatedAt: new Date().toISOString(),
          version: version ?? 1,
        });
      } else {
        setIntake({
          completed: false,
          lastUpdatedAt: null,
          version: 0,
        });
      }
    },
    [setIntake]
  );

  const toggleSkill = useCallback(
    (moduleId: string, index: number, checked: boolean) => {
      setModulesProgress((prev) => {
        const current = prev[moduleId] ?? [];
        const next = checked
          ? current.includes(index)
            ? current
            : [...current, index]
          : current.filter((i) => i !== index);
        return { ...prev, [moduleId]: next };
      });
    },
    [setModulesProgress]
  );

  const getModuleProgress = useCallback(
    (moduleId: string, totalSkills: number) => {
      const checked = modulesProgress[moduleId]?.length ?? 0;
      if (totalSkills === 0) return 0;
      return Math.round((checked / totalSkills) * 100);
    },
    [modulesProgress]
  );

  const awardBadge = useCallback(
    (moduleId: string) => {
      setEarnedBadges((prev) => (prev.includes(moduleId) ? prev : [...prev, moduleId]));
    },
    [setEarnedBadges]
  );

  const sessionValid = isStudentSessionValid();
  const effectiveLoggedIn = isLoggedIn && sessionValid;

  const value = useMemo(
    () => ({
      isLoggedIn: effectiveLoggedIn,
      user,
      intake,
      modulesProgress,
      earnedBadges,
      login,
      logout,
      markIntakeSubmitted,
      syncIntakeOnLogin,
      toggleSkill,
      getModuleProgress,
      awardBadge,
    }),
    [
      effectiveLoggedIn,
      user,
      intake,
      modulesProgress,
      earnedBadges,
      login,
      logout,
      markIntakeSubmitted,
      syncIntakeOnLogin,
      toggleSkill,
      getModuleProgress,
      awardBadge,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
