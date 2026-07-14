import type { IntakeFormData, IntakeStep } from '../types/intake';

export function validateIntakeStep(step: IntakeStep, data: IntakeFormData): string | null {
  switch (step) {
    case 1:
      if (!data.name.trim()) return 'Full name is required';
      if (!data.dob) return 'Date of birth is required';
      if (!data.studentId.trim()) return 'Student ID is required';
      if (!data.address.trim()) return 'Address is required';
      if (!data.phone.trim()) return 'Phone is required';
      if (!data.email.trim()) return 'Email is required';
      return null;
    case 2:
      if (data.medConditions === 'Yes' && !data.medConditionsDetail.trim()) {
        return 'Please describe medical conditions';
      }
      return null;
    case 3:
      if (data.allergies === 'Yes' && !data.allergiesDetail.trim()) {
        return 'Please list allergies';
      }
      return null;
    case 4:
      if (data.medications === 'Yes' && !data.medicationsDetail.trim()) {
        return 'Please list medications';
      }
      return null;
    case 5:
      if (!data.pcpName.trim()) return 'Primary care provider name is required';
      if (!data.pcpPhone.trim()) return 'Primary care provider phone is required';
      if (!data.clinicName.trim()) return 'Clinic name is required';
      if (!data.clinicPhone.trim()) return 'Clinic phone is required';
      if (!data.lastCheckup) return 'Last checkup date is required';
      return null;
    case 6:
      if (!data.consent) return 'Consent is required';
      return null;
    default:
      return null;
  }
}
