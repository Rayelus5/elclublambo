import { type ConfigKey, type ConfigValue, parseConfig } from '@galaxy/shared';

/** What routes need from the live configuration (GDD §16.3). */
export interface ConfigReader {
  get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
}

/** Schema defaults only: used until the DB-backed service is wired in (and as its fallback). */
export const defaultConfigReader: ConfigReader = {
  get: async (key) => parseConfig(key, {}),
};
