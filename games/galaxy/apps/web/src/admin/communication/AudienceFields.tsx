import type { MailAudience } from '@galaxy/shared';
import { useId } from 'react';
import { useMailPreview } from '../../api/mail';
import { copy } from '../../copy/es';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { useSettled } from '../../ui/useSettled';
import { type AudienceKind, audienceOf, type AudienceValue } from './audience';

// Who a message goes to (GDD §16.5; mail v2), taken out of the compose form for the popups' wizard («Encuestas y
// avisos»): everyone, a list of accounts or a segment by level and sign-up date, and how many accounts it reaches now,
// counted by the server once the typing stops (or what to fix, instead of counting forever).

const t = copy.admin.communication;

/** The audience the fields describe, what is wrong with it, and how many accounts it reaches (undefined while counting). */
export interface AudienceReach {
  audience: MailAudience | null;
  problem?: string;
  recipients: number | undefined;
}

/** The audience of `value` and its reach, asked of the server 400 ms after the typing stops. */
export function useAudienceReach(value: AudienceValue): AudienceReach {
  const { audience, problem } = audienceOf(value);
  const json = audience ? JSON.stringify(audience) : '';
  const settled = useSettled(json, 400);
  const preview = useMailPreview(settled ? (JSON.parse(settled) as MailAudience) : null);
  const recipients = settled && settled === json ? preview.data?.recipients : undefined;
  return { audience, problem, recipients };
}

export interface AudienceFieldsProps {
  value: AudienceValue;
  onChange: (value: AudienceValue) => void;
  /** `useAudienceReach(value)`, for the reach line (the form needs it too: the count, the send button). */
  reach: AudienceReach;
}

/** The audience's fields and its live reach line; controlled (`value` and `onChange`), with the reach from the parent. */
export function AudienceFields({ value, onChange, reach }: AudienceFieldsProps) {
  const ids = useId();
  const set = (k: Exclude<keyof AudienceValue, 'kind'>, v: string) => onChange({ ...value, [k]: v });
  const field = (k: 'minLevel' | 'maxLevel' | 'joinedFrom' | 'joinedTo', date = false) => (
    <div className="field">
      <label htmlFor={`${ids}-${k}`}>{t.fields[k]}</label>
      <div className="control">
        {date ? (
          <DateField id={`${ids}-${k}`} value={value[k]} onChange={(v) => set(k, v)} />
        ) : (
          <input id={`${ids}-${k}`} type="text" inputMode="numeric" autoComplete="off" value={value[k]} onChange={(e) => set(k, e.target.value.replace(/\D/g, ''))} />
        )}
      </div>
    </div>
  );
  return (
    <>
      <div className="field">
        <label htmlFor={`${ids}-audience`}>{t.fields.audience}</label>
        <div className="control">
          <Select<AudienceKind>
            id={`${ids}-audience`}
            size="lg"
            block
            value={value.kind}
            options={(['all', 'names', 'segment'] as const).map((k) => ({ value: k, label: t.audiences[k] ?? k }))}
            onChange={(kind) => onChange({ ...value, kind })}
          />
        </div>
      </div>
      {value.kind === 'names' ? (
        <div className="field">
          <label htmlFor={`${ids}-usernames`}>{t.fields.usernames}</label>
          <div className="control">
            <textarea id={`${ids}-usernames`} rows={3} value={value.usernames} onChange={(e) => set('usernames', e.target.value)} />
          </div>
          <p className="hint">{t.usernamesHint}</p>
        </div>
      ) : null}
      {value.kind === 'segment' ? (
        <div className="comms-row">
          {field('minLevel')}
          {field('maxLevel')}
          {field('joinedFrom', true)}
          {field('joinedTo', true)}
          <p className="hint comms-wide">{t.segmentHint}</p>
        </div>
      ) : null}
      <p className={`comms-reach${reach.problem ? ' bad' : ''}`} aria-live="polite">
        {reach.problem ?? (reach.audience ? (reach.recipients === undefined ? t.counting : t.reach(reach.recipients)) : null)}
      </p>
    </>
  );
}
