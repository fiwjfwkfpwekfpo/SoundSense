import type { EnvironmentApi, EnvironmentState } from './environment';
export function createEnvironment(online = true): EnvironmentApi {
  let state: EnvironmentState = { scenario: 'normal', online, loading: false, error: false };
  const listeners = new Set<(value: EnvironmentState) => void>();
  return { getSnapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setOnline(online) { state = { ...state, online }; for (const listener of listeners) listener(state); }, setScenario() {}, retry() {}, dispose() { listeners.clear(); } };
}
