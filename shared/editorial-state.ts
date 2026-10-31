export function isWithdrawn(kind: string, document?: Record<string, unknown>): boolean {
  return (
    !!document &&
    (kind === 'page'
      ? document.status === 'hidden'
      : ['dish', 'category'].includes(kind) && document.visible === false)
  );
}
export function canWithdraw(kind: string, document: Record<string, unknown>): boolean {
  return (
    ['page', 'dish', 'category'].includes(kind) &&
    !(kind === 'page' && (document.slug as { current?: string } | undefined)?.current === 'inicio')
  );
}
export function editorialState(item: { published: boolean; draft: boolean; withdrawn?: boolean }) {
  if (item.withdrawn) return 'withdrawn';
  if (item.draft) return item.published ? 'pending' : 'draft';
  return 'published';
}
export const editorialLabels = {
  published: 'Publicado',
  draft: 'Borrador',
  pending: 'Cambios pendientes de publicar',
  withdrawn: 'Retirado de publicación',
} as const;
