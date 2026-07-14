import type { ModuleRecord } from '../types/module';
import type { EncryptedBundle, PendingSubmission, SubmissionRow } from '../types/submission';
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

export function getPendingSubmissions(): PendingSubmission[] {
  const raw = localStorage.getItem(PENDING_KEY);
  return raw ? (JSON.parse(raw) as PendingSubmission[]) : [];
}

export function savePendingSubmissions(items: PendingSubmission[]): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

export function queuePendingSubmission(item: PendingSubmission): void {
  const items = getPendingSubmissions();
  items.push(item);
  savePendingSubmissions(items);
}

export async function submitEncryptedIntake(
  bundle: EncryptedBundle,
  studentIdHash: string
): Promise<{ queued: boolean }> {
  const url = getGasUrl();
  const token = getGasToken();

  if (!url || !token || !navigator.onLine) {
    queuePendingSubmission({
      id: crypto.randomUUID(),
      bundle,
      studentIdHash,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      token,
      studentIdHash,
      encryptedPayload: JSON.stringify(bundle),
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    queuePendingSubmission({
      id: crypto.randomUUID(),
      bundle,
      studentIdHash,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }

  return { queued: false };
}

export async function flushPendingSubmissions(): Promise<number> {
  const url = getGasUrl();
  const token = getGasToken();
  if (!url || !token || !navigator.onLine) return 0;

  const pending = getPendingSubmissions();
  if (pending.length === 0) return 0;

  const remaining: PendingSubmission[] = [];

  for (const item of pending) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          token,
          studentIdHash: item.studentIdHash,
          encryptedPayload: JSON.stringify(item.bundle),
          timestamp: item.timestamp,
        }),
      });
      if (!response.ok) remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }

  savePendingSubmissions(remaining);
  return pending.length - remaining.length;
}

export async function fetchEncryptedSubmissions(): Promise<SubmissionRow[]> {
  const url = getGasUrl();
  const token = getGasToken();
  if (!url || !token) return [];

  const fetchUrl = `${url}?action=submissions&token=${encodeURIComponent(token)}`;
  const response = await fetch(fetchUrl);
  if (!response.ok) return [];

  const data = (await response.json()) as { submissions?: SubmissionRow[] };
  return data.submissions ?? [];
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
            knowledges: [row.en_knowledge_1, row.en_knowledge_2, row.en_knowledge_3].filter(
              Boolean
            ) as string[],
            skills: [row.en_skill_1, row.en_skill_2, row.en_skill_3, row.en_skill_4, row.en_skill_5].filter(
              Boolean
            ) as string[],
          },
          es: {
            script: row.es_script ?? '',
            knowledges: [row.es_knowledge_1, row.es_knowledge_2, row.es_knowledge_3].filter(
              Boolean
            ) as string[],
            skills: [row.es_skill_1, row.es_skill_2, row.es_skill_3, row.es_skill_4, row.es_skill_5].filter(
              Boolean
            ) as string[],
          },
          pt: {
            script: row.pt_script ?? '',
            knowledges: [row.pt_knowledge_1, row.pt_knowledge_2, row.pt_knowledge_3].filter(
              Boolean
            ) as string[],
            skills: [row.pt_skill_1, row.pt_skill_2, row.pt_skill_3, row.pt_skill_4, row.pt_skill_5].filter(
              Boolean
            ) as string[],
          },
          fr: {
            script: row.fr_script ?? '',
            knowledges: [row.fr_knowledge_1, row.fr_knowledge_2, row.fr_knowledge_3].filter(
              Boolean
            ) as string[],
            skills: [row.fr_skill_1, row.fr_skill_2, row.fr_skill_3, row.fr_skill_4, row.fr_skill_5].filter(
              Boolean
            ) as string[],
          },
          ht: {
            script: row.ht_script ?? '',
            knowledges: [row.ht_knowledge_1, row.ht_knowledge_2, row.ht_knowledge_3].filter(
              Boolean
            ) as string[],
            skills: [row.ht_skill_1, row.ht_skill_2, row.ht_skill_3, row.ht_skill_4, row.ht_skill_5].filter(
              Boolean
            ) as string[],
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
