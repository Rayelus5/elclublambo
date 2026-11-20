import { type AdminMailType, MAIL_TYPES } from '@galaxy/shared';
import { useId } from 'react';
import { copy } from '../../copy/es';
import { MAIL_TYPE_LOOK } from '../../mail/types';
import { Icon } from '../../ui/Icon';

// What kind of message it is (mail v2, P3; the owner: «Sí, con su estilo»): one card per kind with its icon, colour,
// name and what it is for. Native radios: the arrows move between them, and each says its use as its description.

export function TypePicker({ value, onChange }: { value: AdminMailType; onChange: (type: AdminMailType) => void }) {
  const ids = useId();
  return (
    <fieldset className="mail-types">
      <legend>{copy.admin.communication.fields.type}</legend>
      {MAIL_TYPES.map((type) => {
        const look = MAIL_TYPE_LOOK[type];
        const hint = `${ids}-${type}`;
        return (
          <label key={type} className={`mail-type k-${look.tone}`}>
            <input type="radio" name={`${ids}-type`} value={type} checked={value === type} aria-describedby={hint} onChange={() => onChange(type)} />
            <Icon name={look.icon} />
            <b>{copy.mailTypes[type].name}</b>
            <small id={hint} aria-hidden="true">
              {copy.mailTypes[type].hint}
            </small>
          </label>
        );
      })}
    </fieldset>
  );
}
