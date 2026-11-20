import { within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

// The game's dropdowns are its own (ui/Select.tsx), not native selects, so `userEvent.selectOptions` no longer applies:
// a test opens the combobox and clicks the option, as a player does. The option is found by its visible name and,
// failing that, by its value (what the old `selectOptions` calls passed).

/** Opens `combobox` and picks the option named `option` (its visible text, or its value). */
export async function pickOption(user: Pick<UserEvent, 'click'>, combobox: HTMLElement, option: string): Promise<void> {
  if (combobox.getAttribute('aria-expanded') !== 'true') await user.click(combobox);
  const id = combobox.getAttribute('aria-controls');
  const list = id ? document.getElementById(id) : null;
  if (!list) throw new Error(`El desplegable «${combobox.textContent ?? ''}» no abrió su lista`);
  const byName = within(list).queryByRole('option', { name: option });
  const byValue = [...list.querySelectorAll<HTMLElement>('[role="option"]')].find((el) => el.dataset['value'] === option);
  const target = byName ?? byValue;
  if (!target) throw new Error(`No hay ninguna opción «${option}» en el desplegable`);
  await user.click(target);
}
