function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(
  passcode: string,
  payload: object
): Promise<{ v: number; salt: string; iv: string; ciphertext: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passcode, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    v: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptPayload<T>(
  passcode: string,
  bundle: { salt: string; iv: string; ciphertext: string }
): Promise<T> {
  const salt = fromBase64(bundle.salt);
  const iv = fromBase64(bundle.iv);
  const ciphertext = fromBase64(bundle.ciphertext);
  const key = await deriveKey(passcode, salt);

  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    throw new Error('DECRYPT_FAILED');
  }
}

export async function hashStudentId(studentId: string): Promise<string> {
  const encoded = new TextEncoder().encode(studentId);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return toBase64(new Uint8Array(hash)).slice(0, 16);
}
