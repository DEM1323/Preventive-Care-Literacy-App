import { writeFile } from 'node:fs/promises';
import {
  deployRenderTopology,
  runRenderJob,
} from '../packages/render/src/index.ts';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const apiKey = requiredEnvironment('RENDER_API_KEY');
const imageRef = requiredEnvironment('IMAGE_REF');
const workerServiceId = requiredEnvironment('RENDER_WORKER_SERVICE_ID');
let providerSmoke: { jobId: string } | undefined;
const deployment = await deployRenderTopology({
  apiKey,
  webServiceId: requiredEnvironment('RENDER_WEB_SERVICE_ID'),
  workerServiceId,
  imageRef,
  verify: async () => {
    providerSmoke = await runRenderJob({
      apiKey,
      serviceId: workerServiceId,
      startCommand: 'bun scripts/check-providers.ts',
    });
  },
});
if (!providerSmoke) throw new Error('Render provider smoke job did not run');
const release = { ...deployment, providerSmoke };
for (const [role, result] of Object.entries(deployment)) {
  console.log(
    JSON.stringify({
      name: 'render.deployment.completed',
      role,
      deployId: result.deployId,
      digest: result.digest,
    }),
  );
}
const releasePath = process.env.RENDER_RELEASE_PATH;
if (releasePath) await writeFile(releasePath, JSON.stringify(release));
