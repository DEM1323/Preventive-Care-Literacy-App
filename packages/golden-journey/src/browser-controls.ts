export const goldenJourneyBrowserControls = {
  signIn: ['email', 'password', 'submit'],
  invitation: ['email', 'text', 'submit'],
  configuration: ['preview-locale', 'preview-width'],
  staffHome: ['class-name', 'invitation-recipient'],
  studentHomeUnlocked: ['open-learning'],
  intakeAccepted: ['back-to-learning-space'],
  learning: ['back-to-student'],
} as const;
