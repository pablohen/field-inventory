/** Where the admin layout sends a visitor: login, the desk, or nowhere (admin). */
export function adminTarget(
  session: { role: string } | null,
): '/desk/login' | '/' | null {
  if (!session) return '/desk/login';
  return session.role === 'admin' ? null : '/';
}
