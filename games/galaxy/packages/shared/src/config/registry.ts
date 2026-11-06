import { z } from 'zod';

/**
 * Registro de la configuración viva (GDD §16.3). Cada clave tiene su esquema; la base guarda versiones de solo
 * añadir en galaxy.game_config_versions y el servidor valida con estos esquemas al leer y al publicar.
 * Los esquemas son estrictos: una clave mal escrita es un error, nunca se ignora en silencio.
 */
const limit = (def: number) => z.number().int().min(1).max(1000).default(def);

export const configSchemas = {
  features: z
    .object({
      registrationOpen: z.boolean().default(true),
      maintenance: z.boolean().default(false),
    })
    .strict(),
  auth: z.object({
    sessionDays: z.number().int().min(1).max(90).default(30),
    adminSessionHours: z.number().int().min(1).max(72).default(12),
    registerPerIpHour: limit(5),
    loginPerIpTenMin: limit(30),
    loginPerUserTenMin: limit(10),
    totpPerAccountTenMin: limit(10),
    resetRedeemPerIpHour: limit(10),
  }).strict(),
} as const;

export type ConfigKey = keyof typeof configSchemas;
export type ConfigValue<K extends ConfigKey> = z.output<(typeof configSchemas)[K]>;
export const CONFIG_KEYS = Object.keys(configSchemas) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(configSchemas, key);
}

/** Valida `data` con el esquema de `key` y devuelve el valor con los valores por defecto aplicados. Lanza si no vale. */
export function parseConfig<K extends ConfigKey>(key: K, data: unknown): ConfigValue<K> {
  if (!isConfigKey(key)) throw new Error(`unknown_config_key:${String(key)}`);
  return configSchemas[key].parse(data) as ConfigValue<K>;
}
