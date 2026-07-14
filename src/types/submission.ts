export interface EncryptedBundle {
  v: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface SubmissionRow {
  id: string;
  timestamp: string;
  studentIdHash: string;
  encryptedPayload: string;
  submissionStatus: string;
}

export interface PendingSubmission {
  id: string;
  bundle: EncryptedBundle;
  studentIdHash: string;
  timestamp: string;
}
