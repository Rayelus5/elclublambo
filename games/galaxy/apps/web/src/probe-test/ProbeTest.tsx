import { PROBE_TEST, scoreTest, type Starter } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { spriteDataUrl } from '../arena/sprites';
import { useProbeTest } from '../api/runs';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The probe test (GDD §6, §12.2; DESIGN_SYSTEM §8 sexies): PERKINS asks five questions, one at a time; a sixth only
// when the five tie. The answers are sent once at the end (nothing is kept before: a reload starts again), and the
// probe they give is revealed with its profile. «Saltar el test» answers at random: you still discover the probe.

const t = copy.probeTest;
const N = PROBE_TEST.questions.length;

/** Random answers (0–2) from the browser's crypto, with the tiebreak when they tie. */
function randomAnswers(): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(N + 1));
  const five = [...bytes.slice(0, N)].map((b) => b % 3);
  return 'tie' in scoreTest(five) ? [...five, bytes[N]! % 3] : five;
}

type Stage = 'intro' | 'questions' | 'sending' | 'failed' | 'reveal';

export function ProbeTestScreen() {
  const [stage, setStage] = useState<Stage>('intro');
  const [answers, setAnswers] = useState<number[]>([]);
  const [probe, setProbe] = useState<Starter | null>(null);
  const send = useProbeTest();
  const first = useRef<HTMLButtonElement>(null);

  const tied = answers.length === N && 'tie' in scoreTest(answers);
  const question = answers.length < N ? t.questions[answers.length]! : tied ? t.tiebreak : null;

  function submit(list: number[]): void {
    setStage('sending');
    send.mutate(
      { answers: list },
      {
        onSuccess: (r) => {
          setProbe(r.probe as Starter);
          setStage('reveal');
        },
        onError: () => setStage('failed'),
      },
    );
  }

  /** Skipping answers at random: the probe is still discovered, never chosen. */
  function skip(): void {
    const list = randomAnswers();
    setAnswers(list);
    submit(list);
  }

  function choose(i: number): void {
    const next = [...answers, i];
    setAnswers(next);
    if (next.length === N + 1 || (next.length === N && !('tie' in scoreTest(next)))) submit(next);
  }

  useEffect(() => {
    if (stage !== 'questions') return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const n = Number.parseInt(e.key, 10);
      if (n >= 1 && n <= 3) {
        e.preventDefault();
        choose(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // choose reads the latest answers through this effect's dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, answers]);

  if (stage === 'intro') {
    return (
      <main className="screen-root probe-test">
        <div className="probe-test-card intro">
          <h1>{t.title}</h1>
          <p className="probe-test-radio">
            <b>PERKINS</b>
            <span>{t.intro}</span>
          </p>
          <button type="button" className="lip launch" onClick={() => setStage('questions')} autoFocus>
            <Icon name="play" />
            <span>{t.start}</span>
          </button>
          <button type="button" className="probe-test-skip" onClick={skip}>
            {t.skip}
          </button>
        </div>
      </main>
    );
  }

  if (stage === 'reveal' && probe) {
    const def = DEFAULT_CONTENT.probes.find((p) => p.id === probe)!;
    const weapon = DEFAULT_CONTENT.weapons.find((w) => w.id === def.weapon);
    return (
      <main className={`screen-root probe-test reveal p-${probe}`}>
        <div className="probe-test-card reveal" role="status">
          <span className="probe-test-kicker">{t.yourProbe}</span>
          <img className="probe-reveal-art" src={spriteDataUrl(def.sprite, 10)} alt="" width={160} height={160} />
          <h1>{def.name}</h1>
          <p className="probe-profile">{t.profiles[probe]}</p>
          <dl className="hangar-stats">
            <div>
              <dt>{copy.hangar.hp}</dt>
              <dd>{def.hp}</dd>
            </div>
            <div>
              <dt>{copy.hangar.speed}</dt>
              <dd>{def.speed}</dd>
            </div>
            <div>
              <dt>{copy.hangar.weapon}</dt>
              <dd>
                {weapon && <img src={spriteDataUrl(weapon.icon, 2)} alt="" width={24} height={24} />}
                {weapon?.name}
              </dd>
            </div>
          </dl>
          {def.quirk && (
            <p className="probe-quirk">
              <b>{t.quirk}</b>
              <span>{t.quirks[def.quirk.kind]}</span>
            </p>
          )}
          <Link to="/incursion" className="lip launch">
            <Icon name="play" />
            <span>{t.toHangar}</span>
          </Link>
        </div>
      </main>
    );
  }

  if (stage === 'sending' || stage === 'failed') {
    return (
      <main className="screen-root probe-test">
        <div className="probe-test-card" role="status">
          {stage === 'sending' ? (
            <p className="probe-test-sending">{t.sending}</p>
          ) : (
            <>
              <p className="field-error">{t.failed}</p>
              <button type="button" className="lip pill pill-solar" onClick={() => submit(answers)}>
                {t.retry}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  const step = Math.min(answers.length + 1, N);
  return (
    <main className="screen-root probe-test">
      <div className="probe-test-card">
        <p className="probe-test-progress" aria-live="polite">
          {tied ? t.tiebreak.kicker : t.progress(step, N)}
        </p>
        <ol className="probe-test-dots" aria-hidden="true">
          {PROBE_TEST.questions.map((_, i) => (
            <li key={i} className={i < answers.length ? 'done' : i === answers.length ? 'now' : ''} />
          ))}
        </ol>
        {question && (
          <>
            <h2 id="probe-q">{question.q}</h2>
            <div className="probe-answers" role="group" aria-label={question.q}>
              {question.answers.map((a, i) => (
                <button key={a} ref={i === 0 ? first : undefined} type="button" className="lip panel probe-answer" onClick={() => choose(i)}>
                  <span className="levelup-key" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>{a}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="probe-test-footer">
          <button type="button" className="lip pill" onClick={() => setAnswers((a) => a.slice(0, -1))} disabled={answers.length === 0}>
            <Icon name="back" />
            <span>{t.back}</span>
          </button>
          <button type="button" className="probe-test-skip" onClick={skip}>
            {t.skip}
          </button>
        </div>
      </div>
    </main>
  );
}

export default ProbeTestScreen;
