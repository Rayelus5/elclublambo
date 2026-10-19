"use client";

import { useRef, useState } from "react";
import { BarChart3, Loader2, Plus, X } from "lucide-react";
import { HowItWorksLink } from "@/components/guide/how-it-works-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcErrorMessage } from "@/lib/errors";
import { createPollAction } from "@/lib/polls/actions";
import { normalizePollText, POLL_LIMITS, validatePollDraft, type PollWeightMode } from "@/lib/polls/polls";

export interface PollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  /** Plain text taken from the composer when the dialog opened (editable here). */
  initialQuestion: string;
  onPosted: (id: string) => void;
  /** The post hit the channel's slowmode: the composer starts its countdown with these seconds. */
  onSlowmode?: (seconds: number) => void;
}

type Field = "question" | "options" | "closesAt" | null;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// "1 hora" carries two minutes of margin: the server demands at least one hour from ITS now, a moment after this click.
const PRESETS = [
  { id: "1h", label: "1 hora", ms: HOUR + 120_000 },
  { id: "1d", label: "1 día", ms: DAY },
  { id: "3d", label: "3 días", ms: 3 * DAY },
  { id: "7d", label: "7 días", ms: 7 * DAY },
] as const;
type Preset = (typeof PRESETS)[number]["id"] | "custom";

const MODES: { id: PollWeightMode; label: string; help?: string }[] = [
  { id: "equal", label: "1 persona, 1 voto" },
  { id: "linear", label: "Lineal según participación", help: "Cada voto pesa lo que sumaban tus participaciones sin bloquear al crear la encuesta." },
  {
    id: "quadratic",
    label: "Cuadrática según participación",
    help: "Cada voto pesa la raíz cuadrada de esas participaciones: quien más aportó pesa más, pero menos que en lineal.",
  },
];

const QUESTION_ERROR_ID = "poll-question-error";
const OPTIONS_ERROR_ID = "poll-options-error";
const CLOSE_ERROR_ID = "poll-close-error";
const ERROR_ID = "poll-error";

function Form({ onOpenChange, channelId, initialQuestion, onPosted, onSlowmode }: PollDialogProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [preset, setPreset] = useState<Preset>("1d");
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState<PollWeightMode>("equal");
  const [error, setError] = useState<{ text: string; field: Field } | null>(null);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);

  const clear = () => setError(null);
  const setOption = (i: number, v: string) => {
    setOptions((o) => o.map((x, j) => (j === i ? v : x)));
    clear();
  };

  /** Moves focus to the field the error is about (the first option for the options error). */
  const focusField = (f: Field) => {
    const id = f === "question" ? "poll-question" : f === "options" ? "poll-option-0" : f === "closesAt" ? "poll-close-at" : null;
    if (id) document.getElementById(id)?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const now = new Date();
    const found = PRESETS.find((p) => p.id === preset);
    const closesAt = found ? new Date(now.getTime() + found.ms) : new Date(custom);
    const check = validatePollDraft({ question, options, closesAt, now });
    if (!check.ok) {
      setError({ text: rpcErrorMessage(check.code), field: check.field });
      focusField(check.field);
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    let res: Awaited<ReturnType<typeof createPollAction>>;
    try {
      res = await createPollAction({ channelId, question, options, closesAt: closesAt.toISOString(), weightMode: mode });
    } catch {
      res = { ok: false, code: "unknown", error: rpcErrorMessage("unknown") };
    }
    busy.current = false;
    setSending(false);
    if (!res.ok) {
      if (res.code === "slowmode" && res.slowmodeSeconds && res.slowmodeSeconds > 0) onSlowmode?.(res.slowmodeSeconds);
      const field: Field = res.code === "question_required" ? "question" : res.code === "poll_options_invalid" ? "options" : res.code === "closes_at_invalid" ? "closesAt" : null;
      setError({ text: res.error, field });
      focusField(field);
      return;
    }
    onPosted(res.messageId);
    onOpenChange(false);
  };

  const fieldError = (f: Exclude<Field, null>) => (error && error.field === f ? error : null);
  const qErr = fieldError("question");
  const oErr = fieldError("options");
  const cErr = fieldError("closesAt");
  const qLen = [...normalizePollText(question)].length;
  const radio = "mt-0.5 size-4 shrink-0 accent-[var(--color-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="poll-question">Pregunta</Label>
        <textarea
          id="poll-question"
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            clear();
          }}
          required
          aria-required="true"
          aria-invalid={qErr ? true : undefined}
          aria-describedby={qErr ? QUESTION_ERROR_ID : undefined}
          rows={3}
          className="w-full min-w-0 rounded-control border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg aria-invalid:border-danger md:text-sm"
        />
        <div className="flex items-start justify-between gap-2">
          {qErr ? (
            <p id={QUESTION_ERROR_ID} className="text-[13px] text-danger">
              {qErr.text}
            </p>
          ) : (
            <span />
          )}
          <span className={qLen > POLL_LIMITS.questionMax ? "font-mono text-[13px] text-danger" : "font-mono text-[13px] text-fg-muted"}>
            {qLen}/{POLL_LIMITS.questionMax}
          </span>
        </div>
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Opciones</legend>
        <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
          {options.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <Input
                id={`poll-option-${i}`}
                aria-label={`Opción ${i + 1}`}
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                aria-invalid={oErr ? true : undefined}
                aria-describedby={oErr ? OPTIONS_ERROR_ID : undefined}
                autoComplete="off"
                maxLength={POLL_LIMITS.optionMax}
              />
              {i >= 2 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar opción ${i + 1}`}
                  onClick={() => {
                    setOptions((all) => all.filter((_, j) => j !== i));
                    clear();
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {oErr ? (
          <p id={OPTIONS_ERROR_ID} className="text-[13px] text-danger">
            {oErr.text}
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">
            De {POLL_LIMITS.optionsMin} a {POLL_LIMITS.optionsMax} opciones distintas, de hasta {POLL_LIMITS.optionMax} caracteres.
          </p>
        )}
        {options.length < POLL_LIMITS.optionsMax ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => {
              setOptions((all) => [...all, ""]);
              clear();
            }}
          >
            <Plus aria-hidden />
            Añadir opción
          </Button>
        ) : null}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Cierre</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {[...PRESETS.map((p) => ({ id: p.id as Preset, label: p.label })), { id: "custom" as Preset, label: "Otra fecha" }].map((p) => (
            <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="poll-close"
                checked={preset === p.id}
                onChange={() => {
                  setPreset(p.id);
                  clear();
                }}
                className={radio.replace("mt-0.5 ", "")}
              />
              {p.label}
            </label>
          ))}
        </div>
        {preset === "custom" ? (
          <>
            <Label htmlFor="poll-close-at">Fecha de cierre</Label>
            <Input
              id="poll-close-at"
              type="datetime-local"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                clear();
              }}
              aria-invalid={cErr ? true : undefined}
              aria-describedby={cErr ? CLOSE_ERROR_ID : undefined}
              className="font-mono"
            />
          </>
        ) : null}
        {cErr ? (
          <p id={CLOSE_ERROR_ID} className="text-[13px] text-danger">
            {cErr.text}
          </p>
        ) : (
          <p className="text-[13px] text-fg-muted">Entre 1 hora y 30 días desde ahora.</p>
        )}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Peso del voto</legend>
        <div className="flex flex-col gap-1">
          {MODES.map((m) => (
            <label key={m.id} htmlFor={`poll-mode-${m.id}`} className="flex min-h-11 cursor-pointer items-start gap-2 py-2.5">
              <input
                type="radio"
                id={`poll-mode-${m.id}`}
                name="poll-mode"
                checked={mode === m.id}
                onChange={() => {
                  setMode(m.id);
                  clear();
                }}
                aria-labelledby={`poll-mode-${m.id}-name`}
                aria-describedby={m.help ? `poll-mode-${m.id}-help` : undefined}
                className={radio}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span id={`poll-mode-${m.id}-name`} className="text-sm">
                  {m.label}
                </span>
                {m.help ? (
                  <p id={`poll-mode-${m.id}-help`} className="text-[13px] text-fg-muted">
                    {m.help}
                  </p>
                ) : null}
              </div>
            </label>
          ))}
        </div>
        <p className="text-[13px] text-fg-muted">
          Con pocos votantes, un voto ponderado puede delatar la participación de alguien. Los resultados ponderados necesitan al menos 5 votantes con
          participaciones (en 1 persona, 1 voto: 3).
        </p>
      </fieldset>

      <p className="rounded-control border border-border bg-surface-2 p-3 text-[13px] text-fg-muted">
        El voto es secreto: nadie, tampoco los admins, verá qué vota cada uno (a nivel de la aplicación). Los resultados se publican al cerrar, si votan al menos 3 personas. La
        encuesta es consultiva: no ejecuta nada por sí sola.
      </p>

      {error && error.field === null ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <HowItWorksLink section="encuestas" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" disabled={sending}>
            {sending ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <BarChart3 aria-hidden />}
            Publicar encuesta
          </Button>
        </div>
      </div>
    </form>
  );
}

export function PollDialog(props: PollDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva encuesta</DialogTitle>
          <DialogDescription>Pregunta al canal y recoge votos en secreto.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open: every opening starts from the composer's current text. */}
        <Form {...props} />
      </DialogContent>
    </Dialog>
  );
}
