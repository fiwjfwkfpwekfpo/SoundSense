import type { Extensions } from '../core/runtime';
import { settingsSchema } from './settings/schema';
import { BETA_FEATURES, DEBUG_TOOLS } from '../core/build';
/** Trusted built-in contributions are data, shared with future registered contributions. */
export function registerBuiltInUi(runtime: Extensions): () => void {
  const disposers: (() => void)[] = [];
  for (const [command, titleKey, icon] of [['next','track.next','next'], ['enqueue','track.enqueue','queue'], ['playlist','track.addPlaylist','plus'], ['like','track.like','heart'], ['download','track.download','download'], ['artist','track.artist','artist'], ['share','track.share','share']]) disposers.push(runtime.ui.register('trackMenu', { id: `builtin.${command}`, command: command!, titleKey: titleKey!, icon: icon! }));
  for (const [command, titleKey, icon, location] of [['like','track.like','heart','side'], ['lyrics','lyrics.title','lyrics','side'], ['shuffle','player.shuffle','shuffle','transport'], ['previous','player.previous','previous','transport'], ['toggle','player.play','play','transport'], ['next','player.next','next','transport'], ['repeat','player.repeat.off','repeat','transport']] as const) disposers.push(runtime.ui.register('playerButtons', { id: `builtin.${command}`, command, titleKey, icon, location }));
  for (const section of [...new Set(settingsSchema.filter(definition => !definition.hidden).map(definition => definition.section))]) disposers.push(runtime.ui.register('settingsSections', { id: `builtin.${section}`, section, titleKey: `settings.${section}` }));
  for (const route of ['home','liked','playlist','search','settings','library','artist','album','collection','import','updates', ...(BETA_FEATURES ? ['plugins', 'plugin'] : []), ...(DEBUG_TOOLS ? ['diagnostics'] : [])]) disposers.push(runtime.ui.register('screens', { id: `builtin.${route}`, route, component: route, titleKey: route === 'import' ? 'import.title' : `nav.${route}` }));
  for (const definition of settingsSchema) disposers.push(runtime.settings.register({ ...definition, id: definition.key }));
  return () => disposers.reverse().forEach(fn => fn());
}
