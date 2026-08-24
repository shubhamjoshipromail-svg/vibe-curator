/**
 * History routing, hand-rolled.
 *
 * Public paths remain linkable and readable while Vite/Railway serve the same
 * application shell for deep links. The standalone wallpaper entrypoint does
 * not use this router.
 */
export type Route =
  | { name: 'explore'; view?: 'projects' | 'market'; folder?: string; type?: string; collection?: string }
  | { name: 'marketplace' }
  | { name: 'labs'; presetId: string; returnTo?: 'explore' | 'marketplace' }
  | { name: 'player' }
  | { name: 'legal'; page: 'privacy' | 'terms' | 'beta' | 'desktop' | 'data' };

export function parseRoute(locationPath: string): Route {
  const legacyHash = locationPath.includes('#/') ? locationPath.slice(locationPath.indexOf('#/') + 1) : locationPath;
  const path = legacyHash.replace(/^#?\/?/, '');
  const [pathname, query = ''] = path.split('?');
  const [head, arg] = pathname.split('/');
  if (head === 'labs' && arg) {
    const from = new URLSearchParams(query).get('from');
    return { name: 'labs', presetId: decodeURIComponent(arg), returnTo: from === 'marketplace' ? 'marketplace' : 'explore' };
  }
  if (head === 'marketplace') return { name: 'marketplace' };
  if (head === 'player') return { name: 'player' };
  if (head === 'privacy' || head === 'terms' || head === 'beta' || head === 'desktop' || head === 'data') {
    return { name: 'legal', page: head };
  }
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

export function toPath(route: Route): string {
  switch (route.name) {
    case 'labs':
      return `/labs/${encodeURIComponent(route.presetId)}${route.returnTo === 'marketplace' ? '?from=marketplace' : ''}`;
    case 'marketplace':
      return '/marketplace';
    case 'player':
      return '/player';
    case 'legal':
      return `/${route.page}`;
    default:
      {
        const params = new URLSearchParams();
        if (route.view) params.set('view', route.view);
        if (route.folder) params.set('folder', route.folder);
        if (route.type) params.set('type', route.type);
        if (route.collection) params.set('collection', route.collection);
        const query = params.toString();
        return `/explore${query ? `?${query}` : ''}`;
      }
  }
}

export function navigate(route: Route): void {
  const next = toPath(route);
  if (`${location.pathname}${location.search}` !== next) history.pushState({}, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('popstate', () => handler(parseRoute(`${location.pathname}${location.search}`)));
}
