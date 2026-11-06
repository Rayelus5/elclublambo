import type { MeResponse } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError, api } from '../api/client';
import { ME_KEY, errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ErrorSummary } from '../ui/ErrorSummary';
import { OtpInput } from '../ui/OtpInput';
import { PrimaryButton } from '../ui/PrimaryButton';

/** Second factor for role holders. The challenge travels in the navigation state, never in the URL. */
export function Verificar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const challenge = (useLocation().state as { challenge?: string } | null)?.challenge;
  const [code, setCode] = useState('');

  const verify = useMutation({
    mutationFn: (body: { challenge: string; code: string }) => api<MeResponse>('/auth/totp', { method: 'POST', body }),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me);
      navigate('/', { replace: true });
    },
    onError: () => setCode(''),
  });

  if (!challenge) return <Navigate to="/entrar" replace />;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length === 6 && challenge) verify.mutate({ challenge, code });
  }

  const expired = verify.error instanceof ApiError && verify.error.code === 'challenge_expired';
  return (
    <section aria-labelledby="h-verificar">
      <h2 id="h-verificar">{copy.verificar.title}</h2>
      <p className="lead">{copy.verificar.lead}</p>
      <ErrorSummary message={errorText(verify.error, copy.errors)} />
      <form noValidate onSubmit={submit}>
        <OtpInput
          label={copy.verificar.code}
          hint={copy.verificar.hint}
          value={code}
          onChange={setCode}
          invalid={!!verify.error && !expired}
        />
        <PrimaryButton type="submit" busy={verify.isPending} disabled={code.length !== 6}>
          {copy.verificar.submit}
        </PrimaryButton>
        <div className="row after">
          <Link className="link" to="/entrar">
            {copy.verificar.back}
          </Link>
        </div>
      </form>
    </section>
  );
}
