// English copy for authentication: sign-in, password change and session notices.
export default {
  login: {
    title: 'Sign in',
    subtitle: 'Sign in with your administrator account.',
    formLabel: 'Administrator sign-in',
    username: 'Username',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    language: 'Language',
    sessionNote:
      'You stay signed in until the session expires or you sign out. Changing the password ends every session.',
  },
  notice: {
    'password-changed': 'Password updated. Sign in with your new password.',
    expired: 'Your session has ended. Sign in to continue.',
    'signed-out': 'You have been signed out.',
  },
  password: {
    title: 'Change password',
    forcedDescription: 'Replace the initial password before using the console.',
    description: 'Change the password of the administrator account.',
    sessionsEnd: 'Every existing session ends after the change.',
    formLabel: 'Change password',
    currentLabel: 'Current password',
    nextLabel: 'New password',
    nextHint: '12–128 characters. Use a password unique to this console.',
    confirmLabel: 'Confirm new password',
    submit: 'Update password',
    submitting: 'Updating…',
  },
  validation: {
    username: 'Enter a username of 1–64 characters.',
    passwordLength: 'Use 12–128 characters, up to 512 UTF-8 bytes.',
    mismatch: 'The new passwords do not match.',
  },
} as const;
