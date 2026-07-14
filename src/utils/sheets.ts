import type { EncryptedBundle, PendingSubmission, StudentSession, SubmissionRow } from '../types/submission';
import type { ModuleRecord } from '../types/module';
import { modulesFallback } from '../data/modules.fallback';

const PENDING_KEY = 'prevcare_pending_submissions';

function getGasUrl(): string | undefined {
  return import.meta.env.VITE_GAS_SUBMIT_URL;
}

function getGasToken(): string | undefined {
  return import.meta.env.VITE_GAS_EXECUTION_TOKEN;
}

function getModulesSheetUrl(): string | undefined {
  return import.meta.env.VITE_MODULES_SHEET_URL;
}

async function gasPost(body: Record<string, unknown>): Promise<Response | null> {
  const url = getGasUrl();
  const token = getGasToken();
  if (!url || !token) return null;

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, ...body }),
  });
}

async function gasGet(params: Record<string, string>): Promise<Response | null> {
  const url = getGasUrl();
  const token = getGasToken();
  if (!url || !token) return null;

  const qs = new URLSearchParams({ token, ...params });
  return fetch(`${url}?${qs.toString()}`);
}

export function getPendingSubmissions(): PendingSubmission[] {
  const raw = localStorage.getItem(PENDING_KEY);
  return raw ? (JSON.parse(raw) as PendingSubmission[]) : [];
}

export function savePendingSubmissions(items: PendingSubmission[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

function queuePending(item: PendingSubmission): void {
  const items = getPendingSubmissions();
  items.push(item);
  savePendingSubmissions(items);
}

export async function requestAccessCode(email: string): Promise<{ success: boolean; error?: string }> {
  const response = await gasPost({ action: 'requestCode', email });
  if (!response) return { success: false, error: 'Service not configured' };
  const data = (await response.json()) as { success?: boolean; error?: string; message?: string };
  if (!response.ok || data.error) return { success: false, error: data.error ?? 'Could not send code' };
  return { success: true };
}

export interface VerifyCodeResult {
  sessionToken: string;
  emailHash: string;
  dataKeySalt: string;
  hasSubmission: boolean;
  submission: SubmissionRow | null;
}

export async function verifyAccessCode(
  email: string,
  code: string
): Promise<{ success: true; data: VerifyCodeResult } | { success: false; error: string }> {
  const response = await gasPost({ action: 'verifyCode', email, code });
  if (!response) return { success: false, error: 'Service not configured' };
  const data = (await response.json()) as VerifyCodeResult & { success?: boolean; error?: string };
  if (!response.ok || data.error || !data.sessionToken) {
    return { success: false, error: data.error ?? 'Invalid or expired code' };
  }
  return {
    success: true,
    data: {
      sessionToken: data.sessionToken,
      emailHash: data.emailHash,
      dataKeySalt: data.dataKeySalt,
      hasSubmission: data.hasSubmission,
      submission: data.submission
        ? {
            id: 'latest',
            timestamp: String(data.submission.timestamp),
            emailHash: data.submission.emailHash,
            studentIdHash: data.submission.studentIdHash,
            encryptedPayload: data.submission.encryptedPayload,
            version: Number(data.submission.version ?? 1),
            submissionStatus: data.submission.submissionStatus ?? 'received',
          }
        : null,
    },
  };
}

export async function fetchStudentSubmission(
  session: StudentSession
): Promise<SubmissionRow | null> {
  const response = await gasGet({
    action: 'studentSubmission',
    sessionToken: session.sessionToken,
  });
  if (!response?.ok) return null;
  const data = (await response.json()) as {
    submission?: SubmissionRow | null;
    error?: string;
  };
  if (!data.submission) return null;
  return {
    id: 'latest',
    timestamp: String(data.submission.timestamp),
    emailHash: data.submission.emailHash,
    studentIdHash: data.submission.studentIdHash,
    encryptedPayload: data.submission.encryptedPayload,
    version: Number(data.submission.version ?? 1),
    submissionStatus: data.submission.submissionStatus ?? 'received',
  };
}

export async function submitFormUpdate(
  session: StudentSession,
  bundle: EncryptedBundle,
  studentIdHash: string
): Promise<{ queued: boolean; version?: number }> {
  if (!navigator.onLine) {
    queuePending({
      id: crypto.randomUUID(),
      bundle,
      emailHash: session.emailHash,
      studentIdHash,
      sessionToken: session.sessionToken,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }

  const response = await gasPost({
    action: 'submitUpdate',
    sessionToken: session.sessionToken,
    emailHash: session.emailHash,
    studentIdHash,
    encryptedPayload: JSON.stringify(bundle),
    timestamp: new Date().toISOString(),
  });

  if (!response?.ok) {
    queuePending({
      id: crypto.randomUUID(),
      bundle,
      emailHash: session.emailHash,
      studentIdHash,
      sessionToken: session.sessionToken,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }

  const data = (await response.json()) as { version?: number; error?: string };
  if (data.error) {
    queuePending({
      id: crypto.randomUUID(),
      bundle,
      emailHash: session.emailHash,
      studentIdHash,
      sessionToken: session.sessionToken,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }

  return { queued: false, version: data.version };
}

export async function flushPendingSubmissions(): Promise<number> {
  const pending = getPendingSubmissions();
  if (pending.length === 0 || !navigator.onLine) return 0;

  const remaining: PendingSubmission[] = [];

  for (const item of pending) {
    try {
      const response = await gasPost({
        action: 'submitUpdate',
        sessionToken: item.sessionToken,
        emailHash: item.emailHash,
        studentIdHash: item.studentIdHash,
        encryptedPayload: JSON.stringify(item.bundle),
        timestamp: item.timestamp,
      });
      if (!response?.ok) {
        remaining.push(item);
        continue;
      }
      const data = (await response.json()) as { error?: string };
      if (data.error) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }

  savePendingSubmissions(remaining);
  return pending.length - remaining.length;
}

export async function fetchEncryptedSubmissions(): Promise<SubmissionRow[]> {
  const response = await gasGet({ action: 'submissions' });
  if (!response?.ok) return [];
  const data = (await response.json()) as { submissions?: SubmissionRow[] };
  return (data.submissions ?? []).map((row, index) => ({
    ...row,
    id: row.id ?? String(index + 1),
    version: Number(row.version ?? 1),
  }));
}

export async function fetchModulesFromSheet(): Promise<ModuleRecord | null> {
  const sheetUrl = getModulesSheetUrl();
  if (!sheetUrl || !navigator.onLine) return null;

  try {
    const response = await fetch(sheetUrl);
    if (!response.ok) return null;

    const text = await response.text();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
      table?: { rows?: Record<string, string>[] };
    };

    const rows = parsed.table?.rows;
    if (!rows?.length) return null;

    const record: ModuleRecord = {};

    for (const row of rows) {
      const moduleId = row.module_id;
      if (!moduleId) continue;

      record[moduleId] = {
        id: moduleId,
        icon: row.icon ?? 'fa-book',
        badgeIcon: row.badge_icon ?? '🏅',
        badgeName: row.badge_name ?? moduleId,
        wordsToPronounce: {
          en: (row.en_words ?? '').split('|').filter(Boolean),
          es: (row.es_words ?? '').split('|').filter(Boolean),
          pt: (row.pt_words ?? '').split('|').filter(Boolean),
          fr: (row.fr_words ?? '').split('|').filter(Boolean),
          ht: (row.ht_words ?? '').split('|').filter(Boolean),
        },
        content: {
          en: {
            script: row.en_script ?? '',
            knowledges: [row.en_knowledge_1, row.en_knowledge_2, row.en_knowledge_3].filter(Boolean) as string[],
            skills: [row.en_skill_1, row.en_skill_2, row.en_skill_3, row.en_skill_4, row.en_skill_5].filter(Boolean) as string[],
          },
          es: {
            script: row.es_script ?? '',
            knowledges: [row.es_knowledge_1, row.es_knowledge_2, row.es_knowledge_3].filter(Boolean) as string[],
            skills: [row.es_skill_1, row.es_skill_2, row.es_skill_3, row.es_skill_4, row.es_skill_5].filter(Boolean) as string[],
          },
          pt: {
            script: row.pt_script ?? '',
            knowledges: [row.pt_knowledge_1, row.pt_knowledge_2, row.pt_knowledge_3].filter(Boolean) as string[],
            skills: [row.pt_skill_1, row.pt_skill_2, row.pt_skill_3, row.pt_skill_4, row.pt_skill_5].filter(Boolean) as string[],
          },
          fr: {
            script: row.fr_script ?? '',
            knowledges: [row.fr_knowledge_1, row.fr_knowledge_2, row.fr_knowledge_3].filter(Boolean) as string[],
            skills: [row.fr_skill_1, row.fr_skill_2, row.fr_skill_3, row.fr_skill_4, row.fr_skill_5].filter(Boolean) as string[],
          },
          ht: {
            script: row.ht_script ?? '',
            knowledges: [row.ht_knowledge_1, row.ht_knowledge_2, row.ht_knowledge_3].filter(Boolean) as string[],
            skills: [row.ht_skill_1, row.ht_skill_2, row.ht_skill_3, row.ht_skill_4, row.ht_skill_5].filter(Boolean) as string[],
          },
        },
      };
    }

    return Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

export function getFallbackModules(): ModuleRecord {
  return modulesFallback;
}
