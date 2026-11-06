import type { ConfigKey, ConfigValue } from '@galaxy/shared';

/** What routes need from the live configuration (GDD §16.3). */
export interface ConfigReader {
  get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
}

