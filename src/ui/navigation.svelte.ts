import { NavigationStack } from '../core/navigation';
import type { Route, Tab, Overlay } from '../core/navigation';
export type { Route, Tab, Overlay } from '../core/navigation';
export type SheetState = { kind: 'track' | 'addPlaylist' | 'share'; trackId: string } |
  { kind: 'playerMenu' | 'sound' | 'sleepTimer' | 'playbackPower' | 'update' } | { kind: 'appearance'; axis: 'style' | 'colors' | 'motion' } | { kind: 'playlistMenu' | 'deletePlaylist'; playlistId: string } |
  { kind: 'select'; id: string; title: string; options: readonly { value: string; label: string }[]; value: string; onselect: (value: string) => void };

export class Navigation {
  private history = new NavigationStack<SheetState>();
  state = $state({ ...this.history.state, route: this.history.entry.route });
  transitionKind = $state<'tab' | 'push'>('push');
  origin = $state({ x: '50%', y: '100%' });
  searchFocus = $state(false);
  searchQuery = $state('');
  scrollElement?: HTMLElement;
  readonly views = new Map<number, Record<string, unknown>>();
  private capture() { if (this.scrollElement) this.history.saveScroll(this.scrollElement.scrollTop); }
  private publish() { this.state = { ...this.history.state, route: this.history.entry.route }; }
  get scroll() { return this.history.entry.scroll; }
  get view() { const key = this.history.entry.key; if (!this.views.has(key)) this.views.set(key, {}); return this.views.get(key)!; }
  go(route: Route, focus = false) {
    this.capture(); this.transitionKind = 'push'; this.searchFocus = focus;
    if (route.name === 'library' || route.name === 'liked') { this.history.switchTab('library'); this.history.root(); if (route.name === 'liked' || route.name === 'library' && route.tab) this.history.go(route); }
    else if (['home', 'search', 'settings'].includes(route.name)) { this.history.switchTab(route.name as Tab); this.history.root(); }
    else this.history.go(route);
    this.publish();
  }
  tab(tab: Tab, event?: MouseEvent) {
    this.transitionKind = 'tab';
    const rect = this.scrollElement?.getBoundingClientRect();
    if (event && rect) this.origin = { x: `${event.clientX - rect.left}px`, y: `${event.clientY - rect.top}px` };
    this.capture();
    if (tab === this.state.activeTab) {
      if ((this.scrollElement?.scrollTop ?? 0) > 2) this.scrollElement?.scrollTo({ top: 0, behavior: 'smooth' });
      else { this.history.root(); this.publish(); }
    } else { this.history.switchTab(tab); this.publish(); }
  }
  open(overlay: Overlay) { this.history.open(overlay); this.publish(); }
  sheet(sheet: SheetState) { this.history.sheet(sheet); this.publish(); }
  replaceSheet(sheet: SheetState) { this.history.replaceSheet(sheet); this.publish(); }
  dismissSheet() { if (this.state.sheet) this.back(); }
  back() { this.capture(); const result = this.history.back(); this.publish(); return result; }
  pop() { this.back(); }
  get canBack() { return this.history.canBack; }
  get overlay() { return this.state.overlays.at(-1); }
}
