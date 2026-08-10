/**
 * Hash routing, hand-rolled.
 *
 * Three routes do not justify a router dependency, and the hash keeps the
 * whole thing a static file — which matters because this eventually gets
 * loaded by a wallpaper host (Plash, Lively) that just points at a URL.
 */
export type Route =
  | { name: 'explore' }
  | { name: 'labs'; presetId: string }
  | { name: 'player' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, arg] = path.split('/');
  if (head === 'labs' && arg) return { name: 'labs', presetId: decodeURIComponent(arg) };
  if (head === 'player') return { name: 'player' };
  return { name: 'explore' };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'labs':
      return `#/labs/${encodeURIComponent(route.presetId)}`;
    case 'player':
      return '#/player';
    default:
      return '#/explore';
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
