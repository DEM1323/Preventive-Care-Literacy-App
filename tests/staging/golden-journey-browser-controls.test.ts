import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { goldenJourneyBrowserControls } from '../../packages/golden-journey/src/browser-controls.ts';

const repo = new URL('../../', import.meta.url);

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, repo), 'utf8');
}

test('browser control catalog ids exist in the pages the golden journey actually renders', async () => {
  const configuration = await source(
    'src/features/admin/SchoolConfigurationPage.tsx',
  );
  const staffHome = await source('src/features/staff/StaffHomePage.tsx');
  const classWorkspace = await source('src/features/staff/ClassWorkspace.tsx');
  const studentAccess = await source(
    'src/features/student-access/StudentAccessPages.tsx',
  );
  const intake = await source('src/features/intake/StudentIntakePage.tsx');
  const learning = await source(
    'src/features/learning/StudentLearningPage.tsx',
  );

  for (const id of goldenJourneyBrowserControls.configuration) {
    expect(configuration).toContain(`id="${id}"`);
  }
  for (const id of goldenJourneyBrowserControls.staffHome) {
    expect(`${staffHome}\n${classWorkspace}`).toContain(`id="${id}"`);
  }
  expect(studentAccess).toContain(
    `id="${goldenJourneyBrowserControls.studentHomeUnlocked[0]}"`,
  );
  expect(intake).toContain(
    `id="${goldenJourneyBrowserControls.intakeAccepted[0]}"`,
  );
  const acceptedBranch = intake.slice(
    intake.indexOf('Intake accepted'),
    intake.indexOf('STEP 02 / INTAKE'),
  );
  expect(acceptedBranch).toContain('id="back-to-learning-space"');
  expect(acceptedBranch).not.toContain('id="save-draft"');
  expect(acceptedBranch).not.toContain('id="submit-intake"');
  expect(learning).toContain(
    `id="${goldenJourneyBrowserControls.learning[0]}"`,
  );
});

test('browser harness expected focus orders use the catalog and the Student UUID filter', async () => {
  const browser = await source('packages/golden-journey/src/browser.ts');
  expect(browser).toContain('goldenJourneyBrowserControls.intakeAccepted');
  expect(browser).toContain('goldenJourneyBrowserControls.studentHomeUnlocked');
  expect(browser).toContain('input.studentId');
  expect(browser).toContain('.fill(studentId)');
  expect(browser).not.toContain("fill('synthetic')");
  expect(browser).not.toContain("'save-draft'");
});
