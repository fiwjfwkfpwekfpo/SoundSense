import { colors, motions } from './presets';
import { motionGroups } from './schema';
import type { MotionGroup, StylePack } from './schema';
export type SelectionSource = 'manual' | 'style' | 'default' | 'system';
export interface Selection { id: string; source: SelectionSource }
function manual(choice: string | undefined) { return !!choice && choice !== 'auto'; }
export function resolveColors(choice: string | undefined, style: StylePack, autoSuggest = true): Selection {
  if (manual(choice)) return { id: choice!, source: 'manual' };
  if (autoSuggest && style.suggest?.colors && colors[style.suggest.colors]) return { id: style.suggest.colors, source: 'style' };
  return { id: 'cover', source: 'default' };
}
export function resolveMotion(common: string | undefined, groups: Partial<Record<MotionGroup, string>>, style: StylePack, autoSuggest = true, reducedMotion = false): { common: Selection; groups: Record<MotionGroup, Selection> } {
  const selection: Selection = manual(common) ? { id: common!, source: 'manual' }
    : reducedMotion ? { id: 'minimal', source: 'system' }
      : autoSuggest && style.suggest?.motion && motions[style.suggest.motion] ? { id: style.suggest.motion, source: 'style' }
        : { id: 'smooth', source: 'default' };
  return { common: selection, groups: Object.fromEntries(motionGroups.map(group => [group, manual(groups[group]) ? { id: groups[group]!, source: 'manual' } : selection])) as Record<MotionGroup, Selection> };
}
