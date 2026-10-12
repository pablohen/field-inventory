/** Where `/` sends a visitor: login, a warehouse's exceptions page, or nowhere (no warehouses). */
export function deskHomeTarget(
  session: { userId: string } | null,
  warehouses: { id: string }[],
): '/desk/login' | `/w/${string}/exceptions` | null {
  if (!session) return '/desk/login';
  const first = warehouses[0];
  return first ? `/w/${first.id}/exceptions` : null;
}
