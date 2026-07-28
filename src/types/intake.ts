export type { IntakeFormData } from './intakeSchema';
export { buildEmptyIntake } from '../data/intake.fallback';
export { intakeFieldsFallback as EMPTY_INTAKE_FIELDS } from '../data/intake.fallback';

import { buildEmptyIntake, intakeFieldsFallback } from '../data/intake.fallback';
import type { IntakeFormData } from './intakeSchema';

/** @deprecated Prefer buildEmptyIntake(schema.fields, email) */
export const EMPTY_INTAKE: IntakeFormData = buildEmptyIntake(intakeFieldsFallback);

export type IntakeStep = number;
