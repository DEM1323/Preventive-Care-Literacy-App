import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAppState } from '../../context/AppStateContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAppState();
  if (!isLoggedIn) return <Navigate to="/sign-in" replace />;
  return children;
}

export function RequireIntake({ children }: { children: ReactNode }) {
  const { intake } = useAppState();
  if (!intake.completed) return <Navigate to="/intake" replace />;
  return children;
}
