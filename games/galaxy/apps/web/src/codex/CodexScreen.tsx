import type { CodexProgress } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { BackLink } from '../ui/BackLink';
import { Icon } from '../ui/Icon';
import { type CodexSection, codexEntries } from './entries';

// The Códice (GDD §15; M7b-2, DESIGN_SYSTEM §8 septvicies): the ECN terminal's records, by section. An open entry shows
// its text (and, for the fauna and the Cores, how to fight them); a locked one says how it opens. Never a wall of text:
// one entry at a time.

const t = copy.codex;
const SECTIONS: CodexSection[] = ['chronicle', 'sectors', 'cores', 'bestiary', 'fragments'];

export function CodexScreen() {
  const progress = useQuery({ queryKey: ['codex'], queryFn: () => api<CodexProgress>('/codex') });
  const entries = useMemo(() => codexEntries(), []);
  const [section, setSection] = useState<CodexSection>('chronicle');
  const [chosen, setChosen] = useState<string | null>(null);
  const p = progress.data;
  const list = entries.filter((e) => e.section === section);
  const open = (id: string) => !!p && !!entries.find((e) => e.id === id)?.open(p);
  const shown = list.find((e) => e.id === chosen) ?? list.find((e) => open(e.id)) ?? list[0];
  const total = p ? entries.filter((e) => e.open(p)).length : 0;
  return (
    <div className="screen-root missions-root">
      <div className="missions codex">
        <header className="collection-bar">
          <BackLink fallback="/estacion">
            <Icon name="back" />
            <span>{t.back}</span>
          </BackLink>
          <h1>{t.title}</h1>
          {p ? <p className="panel-note codex-count">{t.count(total, entries.length)}</p> : null}
        </header>
        {progress.error ? (
          <p className="field-error" role="alert">
            {errorText(progress.error, copy.errors)}
          </p>
        ) : null}
        <div className="tabs missions-tabs" role="tablist" aria-label={t.title}>
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={section === s}
              onClick={() => {
                setSection(s);
                setChosen(null);
              }}
            >
              {t.sections[s]}
            </button>
          ))}
        </div>
        {p ? (
          <div className="codex-body" role="tabpanel" aria-label={t.sections[section]}>
            <ul className="codex-list">
              {list.map((e) => {
                const isOpen = open(e.id);
                return (
                  <li key={e.id}>
                    <button type="button" className={`codex-item${isOpen ? '' : ' locked'}`} aria-pressed={shown?.id === e.id} onClick={() => setChosen(e.id)}>
                      <Icon name={isOpen ? 'book' : 'lock'} />
                      <span>{isOpen ? e.title : t.locked}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {shown ? (
              <article className="lip panel codex-entry" aria-labelledby="codex-entry-title">
                {open(shown.id) ? (
                  <>
                    <h2 id="codex-entry-title">{shown.title}</h2>
                    <p>{shown.text}</p>
                    {shown.fight ? (
                      <p className="codex-fight">
                        <b>{t.fight}</b> {shown.fight}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <h2 id="codex-entry-title">{t.locked}</h2>
                    <p className="panel-note">{shown.hint}</p>
                  </>
                )}
              </article>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
