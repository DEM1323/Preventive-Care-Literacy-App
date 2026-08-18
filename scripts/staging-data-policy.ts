const prohibitedDataPatterns = [
  /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
  /"(?:address|answers|code|generatedContent|requestBody|sessionHandle)"/i,
];

export function assertNoProhibitedData(value: string, source: string): void {
  if (prohibitedDataPatterns.some((pattern) => pattern.test(value))) {
    throw new Error(`${source} contained a prohibited data class`);
  }
}
