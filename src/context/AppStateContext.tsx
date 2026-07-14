import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import type { IntakeFormData } from '../types/intake';

interface User {
  name: string;
  email: string;
}

interface IntakeState {
  completed: boolean;
  data: IntakeFormData | null;
}

interface AppStateContextValue {
  isLoggedIn: boolean;
  user: User;
  intake: IntakeState;
  modulesProgress: Record<string, number[]>;
  earnedBadges: string[];
  login: (name: string, email: string) => void;
  logout: () => void;
  completeIntake: (data: IntakeFormData) => void;
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
    data: null,
  });
  const [modulesProgress, setModulesProgress] = useLocalStorage<Record<string, number[]>>(
    'prevcare_modulesProgress',
    {}
  );
  const [earnedBadges, setEarnedBadges] = useLocalStorage<string[]>('prevcare_earnedBadges', []);

  const login = useCallback(
    (name: string, email: string) => {
      setIsLoggedIn(true);
      setUser({ name, email });
    },
    [setIsLoggedIn, setUser]
  );

  const logout = useCallback(() => {
    setIsLoggedIn(false);
  }, [setIsLoggedIn]);

  const completeIntake = useCallback(
    (data: IntakeFormData) => {
      setIntake({ completed: true, data });
      setUser((prev) => ({ ...prev, name: data.name }));
    },
    [setIntake, setUser]
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

  const value = useMemo(
    () => ({
      isLoggedIn,
      user,
      intake,
      modulesProgress,
      earnedBadges,
      login,
      logout,
      completeIntake,
      toggleSkill,
      getModuleProgress,
      awardBadge,
    }),
    [
      isLoggedIn,
      user,
      intake,
      modulesProgress,
      earnedBadges,
      login,
      logout,
      completeIntake,
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

