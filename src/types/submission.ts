export interface EncryptedBundle {
  v: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface SubmissionRow {
  id: string;
  timestamp: string;
  emailHash: string;
  studentIdHash: string;
  encryptedPayload: string;
  version: number;
  submissionStatus: string;
}

export interface PendingSubmission {
  id: string;
  bundle: EncryptedBundle;
  emailHash: string;
  studentIdHash: string;
  sessionToken: string;
  timestamp: string;
}

export interface StudentSession {
  sessionToken: string;
  email: string;
  emailHash: string;
  dataKeySalt: string;
  expiresAt: string;
}

export const STUDENT_SESSION_KEY = 'prevcare_student_session';
