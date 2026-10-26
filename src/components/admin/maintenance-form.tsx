"use client";

import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Info } from "lucide-react";
import { AdminConfirm } from "@/components/admin/admin-confirm";
import { LocalTime } from "@/components/tickets/local-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMaintenanceAction, setMaintenancePasswordAction } from "@/lib/admin/actions";
import { isMaintenanceActive, type MaintenanceConfig } from "@/lib/admin/state";
import { rpcErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const MESSAGE_MAX = 500;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const CONFIRM_TEXT = "La web se cerrará al público. Tú seguirás entrando.";

type DateField = "returnAt" | "startsAt" | "endsAt";
const DATE_FIELDS: Array<{ key: DateField; label: string }> = [
  { key: "returnAt", label: "Vuelta estimada" },
  { key: "startsAt", label: "Empieza" },
  { key: "endsAt", label: "Termina" },
];

type Status = "active" | "scheduled" | "off";
const STATUS: Record<Status, { text: string; dot: string }> = {
  active: { text: "Activo ahora", dot: "bg-warning" },
  scheduled: { text: "Programado", dot: "bg-accent" },
  off: { text: "Apagado", dot: "bg-fg-muted" },
};

function statusOf(m: MaintenanceConfig, now: number): Status {
  if (isMaintenanceActive(m, now)) return "active";
  if (m.startsAt !== null && now < new Date(m.startsAt).getTime()) return "scheduled";
  return "off";
}

/** `YYYY-MM-DDTHH:mm` in the browser's zone, what a datetime-local input shows. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Local `YYYY-MM-DDTHH:mm` → ISO UTC, read in the browser's zone. Empty or unreadable → null. */
function toIso(local: string): string | null {
  if (local === "") return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const noop = () => () => {};
/** False on the server and during hydration, true after: local times only render in the browser's zone. */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

/** The time, refreshed every 15 s (stable within a window, so it is a valid snapshot): a schedule flips on its own. */
const TICK_MS = 15_000;
const tick = () => Math.floor(Date.now() / TICK_MS) * TICK_MS;
function subscribeTick(onChange: () => void) {
  const id = setInterval(onChange, TICK_MS);
  return () => clearInterval(id);
}
const useNow = () => useSyncExternalStore(subscribeTick, tick, tick);

const textareaClass =
  "min-h-24 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";
const choiceClass = "size-5 shrink-0 accent-[var(--color-accent)] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const optionClass = "flex min-h-11 cursor-pointer items-center gap-2 text-sm text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";

function ErrorLine({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

export function MaintenanceForm({
  maintenance,
  passwordSet,
  passwordUpdatedAt = null,
}: {
  maintenance: MaintenanceConfig;
  passwordSet: boolean;
  passwordUpdatedAt?: string | null;
}) {
  const uid = useId();
  const router = useRouter();
  const hydrated = useHydrated();
  const [, startTransition] = useTransition();

  const [mode, setMode] = useState(maintenance.mode);
  const [messageEs, setMessageEs] = useState(maintenance.messageEs ?? "");
  const [messageEn, setMessageEn] = useState(maintenance.messageEn ?? "");
  // null = untouched: shows (and saves) what is stored. Typing replaces it with the local value of the input.
  const [dates, setDates] = useState<Record<DateField, string | null>>({ returnAt: null, startsAt: null, endsAt: null });
  const [enableNow, setEnableNow] = useState(maintenance.enabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState<"save" | "off" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const status = statusOf(maintenance, useNow());
  const custom = mode === "custom";

  const dateValue = (key: DateField) => dates[key] ?? (hydrated ? toLocalInput(maintenance[key]) : "");
  const dateIso = (key: DateField) => (dates[key] === null ? maintenance[key] : toIso(dates[key]!));

  function draft(): MaintenanceConfig {
    if (!custom) {
      return { enabled: enableNow, mode: "default", messageEs: null, messageEn: null, returnAt: null, startsAt: null, endsAt: null };
    }
    return {
      enabled: enableNow,
      mode: "custom",
      messageEs,
      messageEn,
      returnAt: dateIso("returnAt"),
      startsAt: dateIso("startsAt"),
      endsAt: dateIso("endsAt"),
    };
  }

  const draftStartsLater = custom && dateIso("startsAt") === null;

  function send(config: MaintenanceConfig, kind: "save" | "off") {
    setError(null);
    setBusy(kind);
    startTransition(async () => {
      const res = await setMaintenanceAction(config);
      setBusy(null);
      if (!res.ok) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      if (kind === "off") setEnableNow(false);
      setDates({ returnAt: null, startsAt: null, endsAt: null });
      router.refresh();
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const config = draft();
    const next = statusOf(config, Date.now());
    if (next === "off") return send(config, "save");
    setConfirmTitle(next === "scheduled" ? "¿Programar el mantenimiento?" : "¿Activar el mantenimiento?");
    setConfirmOpen(true);
  }

  function turnOff() {
    const keepTexts = maintenance.mode === "custom" && maintenance.messageEs !== null && maintenance.messageEn !== null;
    send(
      {
        enabled: false,
        mode: keepTexts ? "custom" : "default",
        messageEs: keepTexts ? maintenance.messageEs : null,
        messageEn: keepTexts ? maintenance.messageEn : null,
        returnAt: null,
        startsAt: null,
        endsAt: null,
      },
      "off",
    );
  }

  function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaved(false);
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setPasswordError(rpcErrorMessage("password_invalid"));
      return;
    }
    setPasswordError(null);
    setBusy("password");
    startTransition(async () => {
      const res = await setMaintenancePasswordAction(password);
      setBusy(null);
      if (!res.ok) {
        setPasswordError(rpcErrorMessage(res.error));
        return;
      }
      setPassword("");
      setPasswordSaved(true);
      router.refresh();
    });
  }

  const disabled = busy !== null;

  return (
    <div className="flex flex-col gap-6 rounded-panel border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-fg">
          <span className="text-fg-muted">Estado:</span>
          <span aria-hidden className={cn("size-2 rounded-full", STATUS[status].dot)} />
          <span className="font-bold">{STATUS[status].text}</span>
          {status === "scheduled" && maintenance.startsAt ? (
            <span className="text-fg-muted">
              · desde <LocalTime iso={maintenance.startsAt} />
            </span>
          ) : null}
        </p>
        {status !== "off" ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={turnOff}>
            Desactivar mantenimiento
          </Button>
        ) : null}
      </div>

      <form onSubmit={save} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col" disabled={disabled}>
          <legend className="mb-1 text-sm font-bold text-fg">Modalidad</legend>
          <div className="flex flex-wrap gap-x-6">
            <label className={optionClass}>
              <input type="radio" name={`${uid}-mode`} value="default" checked={!custom} onChange={() => setMode("default")} className={choiceClass} />
              Por defecto
            </label>
            <label className={optionClass}>
              <input type="radio" name={`${uid}-mode`} value="custom" checked={custom} onChange={() => setMode("custom")} className={choiceClass} />
              Personalizado
            </label>
          </div>
          <span className="text-[13px] text-fg-muted">
            {custom
              ? "Tu propio texto en los dos idiomas, con hora de vuelta y programación opcionales."
              : "El mensaje general, sin hora de vuelta. Dura hasta que lo desactives."}
          </span>
        </fieldset>

        {custom ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={`${uid}-es`}>Mensaje en español</Label>
                <textarea
                  id={`${uid}-es`}
                  value={messageEs}
                  onChange={(e) => setMessageEs(e.target.value)}
                  maxLength={MESSAGE_MAX}
                  rows={3}
                  disabled={disabled}
                  className={textareaClass}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor={`${uid}-en`}>Mensaje en inglés</Label>
                <textarea
                  id={`${uid}-en`}
                  value={messageEn}
                  onChange={(e) => setMessageEn(e.target.value)}
                  maxLength={MESSAGE_MAX}
                  rows={3}
                  disabled={disabled}
                  className={textareaClass}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="grid gap-4 sm:grid-cols-3">
                {DATE_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor={`${uid}-${key}`}>{label}</Label>
                    <Input
                      id={`${uid}-${key}`}
                      type="datetime-local"
                      value={dateValue(key)}
                      onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
                      aria-describedby={`${uid}-dates-help`}
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
              <span id={`${uid}-dates-help`} className="text-[13px] text-fg-muted">
                Opcionales, en tu hora local. Con «Empieza» y «Termina» se enciende y se apaga solo.
              </span>
            </div>
          </>
        ) : null}

        <label className={optionClass}>
          <input type="checkbox" checked={enableNow} onChange={(e) => setEnableNow(e.target.checked)} disabled={disabled} className={choiceClass} />
          Activar ahora
        </label>
        {!enableNow && (!custom || draftStartsLater) ? (
          <p className="flex items-start gap-2 text-[13px] text-fg-muted">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {custom ? "Sin «Activar ahora» ni «Empieza», se guarda sin cerrar la web." : "Sin «Activar ahora», se guarda sin cerrar la web."}
          </p>
        ) : null}

        {error ? <ErrorLine>{error}</ErrorLine> : null}

        <Button type="submit" disabled={disabled} className="self-start">
          Guardar mantenimiento
        </Button>
      </form>

      <form onSubmit={savePassword} noValidate className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${uid}-password`}>Contraseña de mantenimiento</Label>
          <p className="text-[13px] text-fg-muted">
            {passwordSet && passwordUpdatedAt ? (
              <>
                Fijada el <LocalTime iso={passwordUpdatedAt} />
              </>
            ) : passwordSet ? (
              "Fijada"
            ) : (
              "Sin fijar"
            )}
          </p>
          {!passwordSet ? (
            <p className="flex items-start gap-2 rounded-control border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
              Sin contraseña, solo tú podrás entrar.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Input
            id={`${uid}-password`}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordSaved(false);
            }}
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={`${uid}-password-help`}
            disabled={disabled}
            className="sm:max-w-sm"
          />
          <Button type="submit" variant="outline" disabled={disabled}>
            Guardar contraseña
          </Button>
        </div>
        <span id={`${uid}-password-help`} className="text-[13px] text-fg-muted">
          De 12 a 128 caracteres. Al cambiarla, el equipo tendrá que volver a entrar.
        </span>
        {passwordError ? <ErrorLine>{passwordError}</ErrorLine> : null}
        {passwordSaved ? (
          <p role="status" className="text-sm text-fg">
            Contraseña guardada.
          </p>
        ) : null}
      </form>

      <AdminConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmTitle}
        description={CONFIRM_TEXT}
        onConfirm={() => send(draft(), "save")}
      />
    </div>
  );
}
