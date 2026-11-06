import type { ConfigKey, ConfigValue } from '@galaxy/shared';

/** What routes need from the live configuration (GDD §16.3). */
export interface ConfigReader {
  get<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
  /** The value together with the version it came from (0: no stored version, schema defaults). */
  getVersioned<K extends ConfigKey>(key: K): Promise<{ value: ConfigValue<K>; version: number }>;
}

