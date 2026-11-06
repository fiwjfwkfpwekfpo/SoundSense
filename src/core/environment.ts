import type { Unsubscribe } from './types';
import { importErrorKinds } from './imports';
export const scenarios = ['normal', 'offline', 'slow', 'errors', 'empty', 'unavailable', ...importErrorKinds.map(kind => `import-${kind}`)] as const;
export type Scenario = typeof scenarios[number];
export interface EnvironmentState { scenario: Scenario; online: boolean; loading: boolean; error: boolean }
export interface EnvironmentApi { getSnapshot(): EnvironmentState; subscribe(listener: (state: EnvironmentState) => void): Unsubscribe; setScenario(scenario: string): void; setOnline(online: boolean): void; retry(): void; dispose(): void }
