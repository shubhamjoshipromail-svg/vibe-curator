/**
 * Hash routing, hand-rolled.
 *
 * Three routes do not justify a router dependency, and the hash keeps the
 * whole thing a static file — which matters because this eventually gets
 * loaded by a wallpaper host (Plash, Lively) that just points at a URL.
 */
export type Route =
  | { name: 'explore'; view?: 'projects' | 'market'; folder?: string; type?: string; collection?: string }
  | { name: 'marketplace' }
  | { name: 'labs'; presetId: string; returnTo?: 'explore' | 'marketplace' }
  | { name: 'player' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [pathname, query = ''] = path.split('?');
  const [head, arg] = pathname.split('/');
  if (head === 'labs' && arg) {
    const from = new URLSearchParams(query).get('from');
    return { name: 'labs', presetId: decodeURIComponent(arg), returnTo: from === 'marketplace' ? 'marketplace' : 'explore' };
  }
  if (head === 'marketplace') return { name: 'marketplace' };
  if (head === 'player') return { name: 'player' };
  const params = new URLSearchParams(query);
  const folder = params.get('folder') ?? undefined;
  const type = params.get('type') ?? undefined;
  return {
    name: 'explore',
    view: params.get('view') === 'projects' || folder || type ? 'projects' : 'market',
    folder,
    type,
    collection: params.get('collection') ?? undefined,
  };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'labs':
      return `#/labs/${encodeURIComponent(route.presetId)}${route.returnTo === 'marketplace' ? '?from=marketplace' : ''}`;
    case 'marketplace':
      return '#/marketplace';
    case 'player':
      return '#/player';
    default:
      {
        const params = new URLSearchParams();
        if (route.view) params.set('view', route.view);
        if (route.folder) params.set('folder', route.folder);
        if (route.type) params.set('type', route.type);
        if (route.collection) params.set('collection', route.collection);
        const query = params.toString();
        return `#/explore${query ? `?${query}` : ''}`;
      }
  }
}

export function navigate(route: Route): void {
  const next = toHash(route);
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(parseRoute(location.hash)));
}
