import { HttpError } from '../errors';
import type { ConfigReader } from './reader';

/** A part of the game the admin can switch off (GDD §16.3; M6b): its writes answer 503 while it is off. */
export async function requireFeature(config: ConfigReader, name: 'market' | 'trades' | 'offers' | 'chat' | 'friends'): Promise<void> {
  if (!(await config.get('features'))[name]) throw new HttpError(503, `${name}_disabled`);
}
