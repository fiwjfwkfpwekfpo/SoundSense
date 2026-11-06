export type Tab = 'home' | 'library' | 'search' | 'settings';
export const tabs: readonly Tab[] = ['home', 'library', 'search', 'settings'];
export type Route = { name: Exclude<Tab, 'library'> | 'liked' } | { name: 'updates' | 'diagnostics' | 'plugins' } | { name: 'plugin'; id: string } | { name: 'playlist'; id: string } | { name: 'library'; tab?: 'playlists' | 'history' | 'downloaded' | 'local' } | { name: 'artist'; id: string } | { name: 'album'; id: string } | { name: 'collection'; id: 'recommendations' | 'history' } | { name: 'import'; source?: string; link?: string; destination?: string };
export type Overlay = 'player' | 'queue' | 'lyrics';
export interface RouteEntry { route: Route; key: number; scroll: number }
export interface NavigationSnapshot<S> { activeTab: Tab; tabs: Record<Tab, readonly RouteEntry[]>; overlays: readonly Overlay[]; sheet: S | null; sheets: readonly S[] }
/** Back is a UI hierarchy, independent of the order in which tabs were visited. */
export class NavigationStack<S> {
  private sequence = 0;
  state: NavigationSnapshot<S> = { activeTab: 'home', tabs: Object.fromEntries(tabs.map(name => [name, [{ route: { name }, key: this.sequence++, scroll: 0 }]])) as unknown as NavigationSnapshot<S>['tabs'], overlays: [], sheet: null, sheets: [] };
  get entry() { return this.state.tabs[this.state.activeTab].at(-1)!; }
  get canBack() { return !!this.state.sheet || !!this.state.overlays.length || this.state.tabs[this.state.activeTab].length > 1 || this.state.activeTab !== 'home'; }
  saveScroll(scroll: number) { const stack = this.state.tabs[this.state.activeTab]; this.state = { ...this.state, tabs: { ...this.state.tabs, [this.state.activeTab]: stack.map((entry, index) => index === stack.length - 1 ? { ...entry, scroll } : entry) } }; }
  go(route: Route) {
    const tab = this.state.activeTab;
    this.state = { ...this.state, tabs: { ...this.state.tabs, [tab]: [...this.state.tabs[tab], { route, key: this.sequence++, scroll: 0 }] }, overlays: [], sheet: null, sheets: [] };
  }
  switchTab(activeTab: Tab) { this.state = { ...this.state, activeTab, overlays: [], sheet: null, sheets: [] }; }
  root() { const tab = this.state.activeTab; this.state = { ...this.state, tabs: { ...this.state.tabs, [tab]: this.state.tabs[tab].slice(0, 1) }, overlays: [], sheet: null, sheets: [] }; }
  open(overlay: Overlay) { if (this.state.overlays.at(-1) !== overlay) this.state = { ...this.state, overlays: [...this.state.overlays, overlay], sheet: null, sheets: [] }; }
  sheet(sheet: S) { this.state = { ...this.state, sheets: this.state.sheet ? [...this.state.sheets, this.state.sheet] : this.state.sheets, sheet }; }
  replaceSheet(sheet: S) { this.state = { ...this.state, sheet }; }
  back(): boolean {
    if (this.state.sheet) this.state = { ...this.state, sheet: this.state.sheets.at(-1) ?? null, sheets: this.state.sheets.slice(0, -1) };
    else if (this.state.overlays.length) this.state = { ...this.state, overlays: this.state.overlays.slice(0, -1) };
    else if (this.state.tabs[this.state.activeTab].length > 1) { const tab = this.state.activeTab; this.state = { ...this.state, tabs: { ...this.state.tabs, [tab]: this.state.tabs[tab].slice(0, -1) } }; }
    else if (this.state.activeTab !== 'home') this.switchTab('home');
    else return false;
    return true;
  }
}
