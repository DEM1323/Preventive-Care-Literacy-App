import type { StudentSession } from '../types/submission';
import { STUDENT_SESSION_KEY } from '../types/submission';

const SESSION_HOURS = 24;

export function getStudentSession(): StudentSession | null {
  const raw = sessionStorage.getItem(STUDENT_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as StudentSession;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      sessionStorage.removeItem(STUDENT_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveStudentSession(session: Omit<StudentSession, 'expiresAt'>): StudentSession {
  const full: StudentSession = {
    ...session,
    expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString(),
  };
  sessionStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(full));
  return full;
}

export function clearStudentSession(): void {
  sessionStorage.removeItem(STUDENT_SESSION_KEY);
}

export function isStudentSessionValid(): boolean {
  return getStudentSession() !== null;
}
