export const invitationCsvMaxBytes = 32 * 1024;
export const invitationCsvMaxRows = 500;
export const invitationCsvMaxFieldLength = 322;

const emailPattern = /^\s*[^\s@]+@[^\s@]+\s*$/;
const headerAliases = new Set(['email', 'email address', 'e-mail']);

export type InvitationCsvRejectionReason =
  'too_large' | 'too_many_rows' | 'empty';

export type InvitationCsvParsedRow =
  | {
      lineNumber: number;
      field: string;
      kind: 'malformed';
    }
  | {
      lineNumber: number;
      field: string;
      kind: 'duplicate_in_file';
      recipient: string;
    }
  | {
      lineNumber: number;
      field: string;
      kind: 'candidate';
      recipient: string;
    };

export type InvitationCsvParseResult =
  | { outcome: 'rejected'; reason: InvitationCsvRejectionReason }
  | { outcome: 'parsed'; rows: InvitationCsvParsedRow[] };

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = () => {
    fields.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (fields.some((value) => value.trim().length > 0)) {
      rows.push(fields);
    }
    fields = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ',') {
      pushField();
      continue;
    }
    if (character === '\n') {
      pushRow();
      continue;
    }
    if (character === '\r') {
      if (input[index + 1] === '\n') index += 1;
      pushRow();
      continue;
    }
    field += character;
  }
  if (quoted || field.length > 0 || fields.length > 0) pushRow();
  return rows;
}

function emailColumnIndex(header: string[]): number | undefined {
  const index = header.findIndex((field) =>
    headerAliases.has(field.trim().toLowerCase()),
  );
  return index >= 0 ? index : undefined;
}

export function parseInvitationCsv(csv: string): InvitationCsvParseResult {
  if (Buffer.byteLength(csv, 'utf8') > invitationCsvMaxBytes) {
    return { outcome: 'rejected', reason: 'too_large' };
  }
  const table = parseCsvRows(csv);
  if (table.length === 0) return { outcome: 'rejected', reason: 'empty' };

  const headerIndex = emailColumnIndex(table[0]!);
  const start = headerIndex === undefined ? 0 : 1;
  const column = headerIndex ?? 0;
  const dataRowCount = table.length - start;
  if (dataRowCount === 0) return { outcome: 'rejected', reason: 'empty' };
  if (dataRowCount > invitationCsvMaxRows) {
    return { outcome: 'rejected', reason: 'too_many_rows' };
  }

  const seen = new Map<string, number>();
  const rows: InvitationCsvParsedRow[] = [];
  for (let index = start; index < table.length; index += 1) {
    const lineNumber = index + 1;
    const raw = (table[index]?.[column] ?? '').trim();
    const field = raw.slice(0, invitationCsvMaxFieldLength);
    if (raw.length > invitationCsvMaxFieldLength || !emailPattern.test(raw)) {
      rows.push({ lineNumber, field, kind: 'malformed' });
      continue;
    }
    const recipient = field.toLowerCase();
    if (seen.has(recipient)) {
      rows.push({
        lineNumber,
        field,
        kind: 'duplicate_in_file',
        recipient,
      });
      continue;
    }
    seen.set(recipient, lineNumber);
    rows.push({
      lineNumber,
      field,
      kind: 'candidate',
      recipient,
    });
  }
  if (rows.length === 0) return { outcome: 'rejected', reason: 'empty' };
  return { outcome: 'parsed', rows };
}
