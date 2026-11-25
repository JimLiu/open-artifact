/** Error boundaries accept anything thrown by Node, Electron or a remote process. */
export function errorInfo(error: unknown): { message: string; code?: string; status?: number } {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  return {
    message: typeof value.message === 'string' ? value.message : String(error),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.status === 'number' ? { status: value.status } : {}),
  };
}
export function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
