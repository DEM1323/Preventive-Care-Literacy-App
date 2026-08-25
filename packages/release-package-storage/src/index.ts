import { createHash } from 'node:crypto';
import {
  InvalidSchoolConfigurationError,
  type ReleasePackageStorage,
} from '../../../modules/school-configuration/index.ts';

export function createMemoryReleasePackageStorage(): ReleasePackageStorage & {
  read(key: string): Uint8Array | undefined;
} {
  const objects = new Map<string, Uint8Array>();
  return {
    async putIfAbsent(input) {
      const existing = objects.get(input.key);
      if (existing) {
        const digest = createHash('sha256').update(existing).digest('hex');
        if (
          digest !== input.digest ||
          existing.byteLength !== input.bytes.byteLength
        ) {
          throw new InvalidSchoolConfigurationError('packageIntegrity');
        }
        return 'matched';
      }
      objects.set(input.key, input.bytes.slice());
      return 'created';
    },
    read(key) {
      return objects.get(key)?.slice();
    },
  };
}

export function createSupabaseReleasePackageStorage(options: {
  supabaseUrl: string;
  secretKey: string;
}): ReleasePackageStorage {
  const headers = {
    apikey: options.secretKey,
    authorization: `Bearer ${options.secretKey}`,
  };
  return {
    async putIfAbsent(input) {
      const objectUrl = `${options.supabaseUrl}/storage/v1/object/${input.bucket}/${input.key}`;
      const created = await fetch(objectUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'x-upsert': 'false',
        },
        body: input.bytes,
      });
      if (created.ok) return 'created';
      if (created.status !== 400 && created.status !== 409) {
        throw new Error(`Release package upload failed (${created.status})`);
      }
      const existing = await fetch(objectUrl, { headers });
      if (!existing.ok) {
        throw new Error(
          'Release package upload outcome could not be reconciled',
        );
      }
      const bytes = new Uint8Array(await existing.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (
        digest !== input.digest ||
        bytes.byteLength !== input.bytes.byteLength
      ) {
        throw new InvalidSchoolConfigurationError('packageIntegrity');
      }
      return 'matched';
    },
  };
}
