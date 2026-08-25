import { writeBuildAttestation } from '../packages/build-attestation/src/index.ts';

const commit = process.env.SOURCE_COMMIT ?? process.env.EXPECTED_COMMIT;
const tree = process.env.SOURCE_TREE ?? process.env.EXPECTED_GIT_TREE;
if (!commit || !tree) {
  console.error('SOURCE_COMMIT and SOURCE_TREE are required');
  process.exit(1);
}

const attestation = await writeBuildAttestation(process.cwd(), {
  commit,
  tree,
});
if (process.argv.includes('--print-digest')) {
  process.stdout.write(`${attestation.artifactDigest}\n`);
}
