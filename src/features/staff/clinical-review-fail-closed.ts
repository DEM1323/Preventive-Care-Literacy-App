export function clinicalHttpFailureLocksAllState(
  status: number,
  problem: { code?: string } | undefined,
): boolean {
  return !(status === 404 && problem?.code === 'INTAKE_RECORD_NOT_FOUND');
}

export function ignoreStaleClinicalGeneration(
  requestGeneration: number,
  currentGeneration: number,
): boolean {
  return requestGeneration !== currentGeneration;
}
