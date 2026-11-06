/** Shared namespace for all persistent UI data, independent of display name. */
export const STORAGE_PREFIX = 'ss_';
export const STORAGE_KEYS = { settings: `${STORAGE_PREFIX}settings_v1`, library: `${STORAGE_PREFIX}library_v1`, player: `${STORAGE_PREFIX}player_v1`, imports: `${STORAGE_PREFIX}imports_v1` } as const;
