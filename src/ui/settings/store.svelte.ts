import type { SettingsApi } from '../../core/api';
import type { SettingsValues, SettingValue } from '../../core/types';
import { defaultSettings, settingsSchema, validateSetting } from './schema';
export class SettingsStore {
  values = $state<SettingsValues>({ ...defaultSettings });
  private unsubscribe: () => void;
  constructor(private api: SettingsApi, private definitions = () => settingsSchema) {
    const invalid: SettingsValues = {};
    for (const definition of this.definitions()) {
      const value = api.getSnapshot()[definition.key];
      if (value !== undefined && validateSetting(definition, value)) this.values[definition.key] = value;
      else invalid[definition.key] = definition.default;
    }
    if (Object.keys(invalid).length) api.setMany(invalid);
    this.unsubscribe = api.subscribe(values => { this.values = { ...defaultSettings, ...values }; });
  }
  set(key: string, value: SettingValue) {
    const definition = this.definitions().find(d => d.key === key);
    if (definition && !definition.disabled && validateSetting(definition, value)) this.api.set(key, value);
  }
  reset() { this.api.reset(); }
  setMany(values: SettingsValues) {
    const valid = Object.fromEntries(Object.entries(values).filter(([key, value]) => { const definition = this.definitions().find(d => d.key === key); return definition && !definition.disabled && validateSetting(definition, value); }));
    this.api.setMany(valid);
  }
  dispose() { this.unsubscribe(); }
}
