import { isDesktop } from '../platform/desktop';
/**
 * Window layout shared by the shell, the player and the lyrics: on a desktop window from
 * 900 px the app uses the wide layout (player bar, two-column player with lyrics).
 */
class Layout {
  wide = $state(false);
  constructor() {
    if (!isDesktop() || typeof matchMedia === 'undefined') return;
    const query = matchMedia('(min-width: 900px)');
    this.wide = query.matches;
    query.addEventListener('change', () => { this.wide = query.matches; });
  }
}
export const layout = new Layout();
