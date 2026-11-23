// The shortest password Kevi accepts for a new or changed password (DPIA
// action 3: account takeover is the highest residual risk to session content).
// Existing passwords keep working; signing in never checks this.
export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(pw) {
  if (!pw) return 'Please enter a password.';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}
