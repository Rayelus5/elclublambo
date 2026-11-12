import type { GalaxySummary } from '@galaxy/shared';
import { GalaxyPicker } from '../cards/GalaxyPicker';
import { copy } from '../copy/es';

// Choosing a galaxy for a relic slot (GDD §8.4): the collection by rarity, filtered by phenomenon or rarity (plan
// «escáner pro», part D); galaxies already in another slot show as equipped and cannot be picked twice. Picking one
// opens its sheet (RelicSheet), where «Equipar» confirms.

const TEXT = { title: copy.hangar.pickerTitle, empty: copy.hangar.pickerEmpty, pick: copy.hangar.sheet.open, taken: copy.collection.equipped };

export function RelicPicker({ taken, onPick, onClose }: { taken: ReadonlySet<string>; onPick: (g: GalaxySummary) => void; onClose: () => void }) {
  return <GalaxyPicker text={TEXT} taken={taken} onPick={onPick} onClose={onClose} className="relic-picker" filters />;
}
