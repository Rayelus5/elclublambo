import { PLAYER_REPORT_REASONS, type PlayerReportReason } from '@galaxy/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Dialog } from '../ui/Dialog';

// Reporting a teammate of a group run (multiplayer plan, phase 7): why (one of five reasons) and, if one wants, what
// happened; once sent, it says a moderator will look at it.

const t = copy.coop.report;

export function ReportDialog({ runId, username, onClose }: { runId: string; username: string; onClose: () => void }) {
  const ids = useId();
  const [reason, setReason] = useState<PlayerReportReason | null>(null);
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => api<{ reported: true }>(`/coop/runs/${runId}/report`, { method: 'POST', body: { username, reason, ...(note.trim() ? { note: note.trim() } : {}) } }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason && !send.isPending) send.mutate();
  };
  return (
    <Dialog title={t.title(username)} onClose={onClose} className="report-dialog">
      {send.isSuccess ? (
        <div className="report-sent">
          <p role="status">{t.sent}</p>
          <button type="button" className="lip pill pill-solar" onClick={onClose}>
            {t.close}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="report-form">
          <fieldset>
            <legend>{t.reasonLabel}</legend>
            {PLAYER_REPORT_REASONS.map((r) => (
              <label key={r} className="report-reason">
                <input type="radio" name={`${ids}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} />
                <span>{t.reasons[r]}</span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={`${ids}-note`}>{t.note}</label>
            <div className="control">
              <textarea id={`${ids}-note`} value={note} maxLength={300} rows={3} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {send.isError ? (
            <p className="field-error" role="alert">
              {errorText(send.error, copy.errors)}
            </p>
          ) : null}
          <button type="submit" className="lip pill pill-solar" disabled={!reason || send.isPending}>
            {t.send}
          </button>
        </form>
      )}
    </Dialog>
  );
}
