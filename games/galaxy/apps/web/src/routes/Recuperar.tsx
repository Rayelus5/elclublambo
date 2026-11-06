import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ErrorSummary } from '../ui/ErrorSummary';
import { Field } from '../ui/Field';
import { PrimaryButton } from '../ui/PrimaryButton';

/** Redeem an admin-issued recovery code (no email in the game). */
export function Recuperar() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [missing, setMissing] = useState(false);

  const redeem = useMutation({
    mutationFn: (body: { username: string; code: string; newPassword: string }) =>
      api<void>('/auth/reset/redeem', { method: 'POST', body }),
    onSuccess: () => navigate('/entrar', { replace: true, state: { notice: 'password_changed' } }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !code || newPassword.length < 10) {
      setMissing(true);
      return;
    }
    setMissing(false);
    redeem.mutate({ username, code, newPassword });
  }

  return (
    <section aria-labelledby="h-recuperar">
      <h2 id="h-recuperar">{copy.recuperar.title}</h2>
      <p className="lead">{copy.recuperar.lead}</p>
      <ErrorSummary message={missing ? copy.errors.invalid_input : errorText(redeem.error, copy.errors)} />
      <form noValidate onSubmit={submit}>
        <Field
          label={copy.fields.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          invalid={missing && !username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label={copy.recuperar.code}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          className="code"
          value={code}
          invalid={missing && !code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Field
          label={copy.recuperar.newPassword}
          autoComplete="new-password"
          password
          hint={copy.crear.passHint}
          value={newPassword}
          invalid={missing && newPassword.length < 10}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <PrimaryButton type="submit" busy={redeem.isPending}>
          {copy.recuperar.submit}
        </PrimaryButton>
        <div className="row after">
          <Link className="link" to="/entrar">
            {copy.recuperar.back}
          </Link>
        </div>
      </form>
    </section>
  );
}
