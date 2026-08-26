import { readFileSync } from 'node:fs';
import {
  assertApprovedTranslationRequest,
  createUnavailableTranslationAdapter,
  restorePlaceholders,
  shieldPlaceholders,
  translationAdapterId,
  translationAdapterVersion,
  translationGlossaryRevision,
  TranslationAdapterRejectedError,
  type ManagedLocale,
  type TranslationAdapter,
} from '../../../modules/school-configuration/index.ts';

export const googleCloudTranslationLocation = 'us-central1' as const;
export const googleCloudTranslationModel = 'nmt' as const;

const localeLanguageCodes: Record<ManagedLocale, string> = {
  'es-US': 'es',
  'pt-BR': 'pt',
  'fr-CA': 'fr',
  'ht-HT': 'ht',
};

type FetchRequest = (input: string, init?: RequestInit) => Promise<Response>;

export function createDeterministicTranslationAdapter(): TranslationAdapter {
  return {
    id: translationAdapterId,
    version: translationAdapterVersion,
    model: 'deterministic-nmt',
    glossaryRevision: translationGlossaryRevision,
    async translate(request) {
      assertApprovedTranslationRequest(request);
      return {
        outputs: request.segments.map((segment) => ({
          sourceResourceId: segment.sourceResourceId,
          locale: segment.locale,
          text: `[${segment.locale}] ${segment.sourceText}`,
          model: 'deterministic-nmt',
        })),
      };
    },
  };
}

export function createGoogleCloudTranslationAdapter(options: {
  projectId: string;
  location?: string;
  credentials: {
    clientEmail: string;
    privateKey: string;
  };
  request?: FetchRequest;
  accessToken?: string;
}): TranslationAdapter {
  const location = options.location ?? googleCloudTranslationLocation;
  const request = options.request ?? fetch;
  return {
    id: translationAdapterId,
    version: translationAdapterVersion,
    model: googleCloudTranslationModel,
    glossaryRevision: translationGlossaryRevision,
    async translate(translationRequest) {
      assertApprovedTranslationRequest(translationRequest);
      const locales = [
        ...new Set(
          translationRequest.segments.map((segment) => segment.locale),
        ),
      ];
      if (locales.length !== 1 || !locales[0]) {
        throw new TranslationAdapterRejectedError('locale');
      }
      const locale = locales[0];
      const accessToken =
        options.accessToken ??
        (await googleAccessToken(options.credentials, request));
      const shielded = translationRequest.segments.map((segment) =>
        shieldPlaceholders(segment.sourceText),
      );
      const response = await request(
        `https://translation.googleapis.com/v3/projects/${encodeURIComponent(options.projectId)}/locations/${encodeURIComponent(location)}:translateText`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            'x-goog-user-project': options.projectId,
          },
          body: JSON.stringify({
            sourceLanguageCode: 'en',
            targetLanguageCode: localeLanguageCodes[locale],
            mimeType: 'text/plain',
            contents: shielded.map((item) => item.shielded),
          }),
        },
      );
      const body = (await response.json()) as {
        translations?: Array<{ translatedText?: string; model?: string }>;
      };
      if (!response.ok || !Array.isArray(body.translations)) {
        throw new TranslationAdapterRejectedError('provider');
      }
      return {
        outputs: translationRequest.segments.map((segment, index) => {
          const translated = body.translations?.[index]?.translatedText;
          if (typeof translated !== 'string') {
            throw new TranslationAdapterRejectedError(segment.sourceResourceId);
          }
          const tokens = shielded[index]?.tokens ?? [];
          return {
            sourceResourceId: segment.sourceResourceId,
            locale: segment.locale,
            text: restorePlaceholders(translated, tokens),
            model:
              body.translations?.[index]?.model ?? googleCloudTranslationModel,
          };
        }),
      };
    },
  };
}

export function translationAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): TranslationAdapter {
  const projectId = environment.GOOGLE_CLOUD_PROJECT;
  const credentialsJson = environment.GOOGLE_TRANSLATION_CREDENTIALS;
  const credentialsPath = environment.GOOGLE_APPLICATION_CREDENTIALS;
  let raw = credentialsJson;
  if (!raw && credentialsPath) {
    try {
      raw = readFileSync(credentialsPath, 'utf8');
    } catch {
      raw = undefined;
    }
  }
  if (!projectId || !raw) {
    return createUnavailableTranslationAdapter();
  }
  let parsed: { client_email?: string; private_key?: string };
  try {
    parsed = JSON.parse(raw) as {
      client_email?: string;
      private_key?: string;
    };
  } catch {
    return createUnavailableTranslationAdapter();
  }
  if (!parsed?.client_email || !parsed.private_key) {
    return createUnavailableTranslationAdapter();
  }
  return createGoogleCloudTranslationAdapter({
    projectId,
    credentials: {
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    },
  });
}

async function googleAccessToken(
  credentials: { clientEmail: string; privateKey: string },
  request: FetchRequest,
): Promise<string> {
  const { createSign } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: credentials.clientEmail,
    scope: 'https://www.googleapis.com/auth/cloud-translation',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3_600,
  })}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(credentials.privateKey, 'base64url')}`;
  const response = await request('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new TranslationAdapterRejectedError('credentials');
  }
  return body.access_token;
}
