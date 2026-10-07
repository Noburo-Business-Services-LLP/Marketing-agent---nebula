/** Whether a failed "who am I" check means the saved login is no good (the server said so), or just that the server could not answer. */
export function serverRejectedSession(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { status?: unknown }).status === 401;
}
