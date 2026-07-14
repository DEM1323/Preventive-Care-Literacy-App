export interface IntakeFormData {
  name: string;
  dob: string;
  studentId: string;
  address: string;
  phone: string;
  email: string;
  medConditions: 'Yes' | 'No';
  medConditionsDetail: string;
  visionConcerns: 'Yes' | 'No';
  allergies: 'Yes' | 'No';
  allergiesDetail: string;
  medications: 'Yes' | 'No';
  medicationsDetail: string;
  pcpName: string;
  pcpPhone: string;
  clinicName: string;
  clinicPhone: string;
  lastCheckup: string;
  safeAtHome: 'Yes' | 'No';
  stableHousing: 'Yes' | 'No';
  reliableFood: 'Yes' | 'No';
  insuranceStatus: 'Yes' | 'No';
  consent: boolean;
}

export const EMPTY_INTAKE: IntakeFormData = {
  name: '',
  dob: '',
  studentId: '',
  address: '',
  phone: '',
  email: '',
  medConditions: 'No',
  medConditionsDetail: '',
  visionConcerns: 'No',
  allergies: 'No',
  allergiesDetail: '',
  medications: 'No',
  medicationsDetail: '',
  pcpName: '',
  pcpPhone: '',
  clinicName: '',
  clinicPhone: '',
  lastCheckup: '',
  safeAtHome: 'Yes',
  stableHousing: 'Yes',
  reliableFood: 'Yes',
  insuranceStatus: 'No',
  consent: false,
};

export type IntakeStep = 1 | 2 | 3 | 4 | 5 | 6;
