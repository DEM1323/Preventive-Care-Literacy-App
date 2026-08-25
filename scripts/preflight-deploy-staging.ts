import { reportDeployStagingPreflight } from '../packages/golden-journey/src/index.ts';

reportDeployStagingPreflight(process.env, { failClosed: true });
