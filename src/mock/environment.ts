import type { EnvironmentApi, EnvironmentState, Scenario } from '../core/environment';
import { scenarios } from '../core/environment';
export function createEnvironment(initial = 'normal', online = true): EnvironmentApi {
  let state: EnvironmentState = { scenario: 'normal', online, loading: false, error: false };
  const listeners = new Set<(state: EnvironmentState) => void>();
  let timer: ReturnType<typeof setTimeout>;
  const emit = () => listeners.forEach(fn => fn(state));
  const api: EnvironmentApi = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setScenario(value) {
      clearTimeout(timer);
      const scenario = scenarios.includes(value as Scenario) ? value as Scenario : 'normal';
      state = { scenario, online: scenario !== 'offline' && online, loading: scenario === 'slow', error: scenario === 'errors' }; emit();
      if (state.loading) timer = setTimeout(() => { state = { ...state, loading: false }; emit(); }, 2000);
    },
    setOnline(value) { online = value; state = { ...state, online: value && state.scenario !== 'offline' }; emit(); },
    retry() { state = { ...state, error: false, loading: true }; emit(); timer = setTimeout(() => { state = { ...state, loading: false }; emit(); }, 650); },
    dispose() { clearTimeout(timer); listeners.clear(); },
  };
  api.setScenario(initial); return api;
}
