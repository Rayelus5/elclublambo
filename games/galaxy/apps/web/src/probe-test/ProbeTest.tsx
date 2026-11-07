import { PROBE_TEST, scoreTest, type Starter } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { spriteDataUrl } from '../arena/sprites';
import { useHangar, useProbeTest } from '../api/runs';
import { copy } from '../copy/es';
import { Icon } from '../ui/Icon';

// The probe test (GDD §6, §12.2; DESIGN_SYSTEM §8 sexies): PERKINS asks five questions, one at a time; a sixth only
// when the five tie. The answers are sent once, after a last step to confirm (nothing is kept before: a reload starts
// again), and the probe they give is revealed with its profile. «Saltar el test» answers at random, also after a
// confirm: you still discover the probe. The result is for good, so a held key or a double click never answers twice.

const t = copy.probeTest;
const N = PROBE_TEST.questions.length;

/** Random answers (0–2) from the browser's crypto, with the tiebreak when they tie. */
function randomAnswers(): number[] {
  const bytes = crypto.getRandomValues(new Uint8Array(N + 1));
  const five = [...bytes.slice(0, N)].map((b) => b % 3);
  return 'tie' in scoreTest(five) ? [...five, bytes[N]! % 3] : five;
}

type Stage = 'intro' | 'questions' | 'confirm' | 'sending' | 'failed' | 'reveal';

/** Five answers with no tie, or five and the tiebreak. */
const complete = (list: number[]) => list.length === N + 1 || (list.length === N && !('tie' in scoreTest(list)));

export function ProbeTestScreen() {
  const [stage, setStage] = useState<Stage>('intro');
  const [answers, setAnswers] = useState<number[]>([]);
  /** «Saltar el test»: the random answers waiting for the confirm, and the step to go back to. */
  const [skipped, setSkipped] = useState<{ answers: number[]; from: Stage } | null>(null);
  const [probe, setProbe] = useState<Starter | null>(null);
  const send = useProbeTest();
  const hangar = useHangar();
  const heading = useRef<HTMLHeadingElement>(null);

  const tied = answers.length === N && 'tie' in scoreTest(answers);
  const question = answers.length < N ? t.questions[answers.length]! : tied ? t.tiebreak : null;

  function submit(): void {
    setStage('sending');
    send.mutate(
      { answers: skipped?.answers ?? answers },
      {
        onSuccess: (r) => {
          setProbe(r.probe as Starter);
          setStage('reveal');
        },
        onError: () => setStage('failed'),
      },
    );
  }

  /** Skipping answers at random: the probe is still discovered, never chosen. The answers given so far are kept. */
  function skip(): void {
    setSkipped({ answers: randomAnswers(), from: stage });
    setStage('confirm');
  }

  function back(): void {
    if (stage === 'confirm' && skipped) {
      setStage(skipped.from);
      setSkipped(null);
      return;
    }
    setAnswers((a) => a.slice(0, -1));
    setStage('questions');
  }

  function choose(i: number): void {
    const next = [...answers, i];
    setAnswers(next);
    if (complete(next)) setStage('confirm');
  }

  // Focus goes to each step's title, never to an answer: a held Enter cannot click its way through the test.
  useEffect(() => {
    if (stage !== 'intro') heading.current?.focus();
  }, [stage, answers.length]);

  useEffect(() => {
    if (stage !== 'questions') return;
    const onKey = (e: KeyboardEvent) => {
      // A held key repeats, and a shortcut is not an answer.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
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
    // Taken already (Back after the reveal, or /crear-cuenta with a session): the test is once, so to the hangar.
    if (hangar.data?.test.taken) return <Navigate to="/incursion" replace />;
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
          <h1 ref={heading} tabIndex={-1}>
            {def.name}
          </h1>
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
              <button type="button" className="lip pill pill-solar" onClick={submit}>
                {t.retry}
              </button>
            </>
          )}
        </div>
      </main>
    );
  }

  if (stage === 'confirm') {
    const c = skipped ? t.skipConfirm : t.confirm;
    return (
      <main className="screen-root probe-test">
        <div className="probe-test-card">
          <h2 ref={heading} tabIndex={-1}>
            {c.title}
          </h2>
          <p className="probe-test-radio">
            <b>PERKINS</b>
            <span>{c.text}</span>
          </p>
          <button type="button" className="lip launch" onClick={submit}>
            <Icon name="play" />
            <span>{t.discover}</span>
          </button>
          <button type="button" className="lip pill" onClick={back}>
            <Icon name="back" />
            <span>{skipped ? t.skipConfirm.cancel : t.back}</span>
          </button>
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
            <h2 id="probe-q" ref={heading} tabIndex={-1}>
              {question.q}
            </h2>
            <div className="probe-answers" role="group" aria-label={question.q}>
              {question.answers.map((a, i) => (
                <button
                  key={a}
                  type="button"
                  className="lip panel probe-answer"
                  // The second click of a double click would land on the next question's answer.
                  onClick={(e) => {
                    if (e.detail <= 1) choose(i);
                  }}
                >
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
          <button type="button" className="lip pill" onClick={back} disabled={answers.length === 0}>
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
