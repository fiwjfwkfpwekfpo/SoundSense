import type { Unsubscribe } from './types';

export type DiagnosticLevel = 'info' | 'warn' | 'error';
export interface DiagnosticEntry { id: number; at: string; level: DiagnosticLevel; scope: string; event: string; data: Readonly<Record<string, string | number | boolean | null>> }
export interface DiagnosticsApi {
  getSnapshot(): readonly DiagnosticEntry[];
  subscribe(listener: (entries: readonly DiagnosticEntry[]) => void): Unsubscribe;
  record(scope: string, event: string, data?: Record<string, unknown>, level?: DiagnosticLevel): void;
  export(): Promise<string>;
  clear(): void;
}
export function errorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const value = error as Record<string, unknown>;
  return { name: value.name, code: value.code, status: value.status, message: value.message, ...(value.kind ? { kind: value.kind } : {}), ...(value.detail ? { detail: value.detail } : {}) };
}
