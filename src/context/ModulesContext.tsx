import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getFallbackModules, fetchModulesFromSheet } from '../utils/sheets';
import type { ModuleRecord } from '../types/module';

interface ModulesContextValue {
  modules: ModuleRecord;
  loading: boolean;
  refreshModules: () => Promise<void>;
}

const ModulesContext = createContext<ModulesContextValue | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ModuleRecord>(getFallbackModules);
  const [loading, setLoading] = useState(false);

  const refreshModules = useCallback(async () => {
    setLoading(true);
    try {
      const remote = await fetchModulesFromSheet();
      if (remote) {
        setModules(remote);
        localStorage.setItem('prevcare_modules_cache', JSON.stringify(remote));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = localStorage.getItem('prevcare_modules_cache');
    if (cached) {
      try {
        setModules(JSON.parse(cached) as ModuleRecord);
      } catch {
        setModules(getFallbackModules());
      }
    }
    void refreshModules();
  }, [refreshModules]);

  const value = useMemo(
    () => ({ modules, loading, refreshModules }),
    [modules, loading, refreshModules]
  );

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export function useModules() {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error('useModules must be used within ModulesProvider');
  return ctx;
}
