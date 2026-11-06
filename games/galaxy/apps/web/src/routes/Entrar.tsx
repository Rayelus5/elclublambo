import type { LoginResponse } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { ME_KEY, errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ErrorSummary } from '../ui/ErrorSummary';
import { Field } from '../ui/Field';
import { PrimaryButton } from '../ui/PrimaryButton';

export function Entrar() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const userRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState(false);

  const login = useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api<LoginResponse>('/auth/login', { method: 'POST', body }),
    onSuccess: (res) => {
      if (res.status === 'totp_required') {
        navigate('/verificar', { state: { challenge: res.challenge } });
        return;
      }
      qc.setQueryData(ME_KEY, res.me);
      navigate('/', { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      setMissing(true);
      if (!username) userRef.current?.focus();
      return;
    }
    setMissing(false);
    login.mutate({ username, password });
  }

  const notice = (location.state as { notice?: string } | null)?.notice === 'password_changed' ? copy.entrar.passwordChanged : null;
  const error = missing ? copy.entrar.required : errorText(login.error, copy.errors);

  return (
    <section aria-labelledby="h-entrar">
      <h2 id="h-entrar">{copy.entrar.title}</h2>
      <p className="lead">{copy.entrar.lead}</p>
      {error ? <ErrorSummary message={error} /> : <ErrorSummary message={notice} tone="info" />}
      <form noValidate onSubmit={submit}>
        <Field
          ref={userRef}
          label={copy.fields.username}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="tu_usuario"
          value={username}
          invalid={missing && !username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Field
          label={copy.fields.password}
          name="password"
          autoComplete="current-password"
          password
          value={password}
          invalid={missing && !password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="row">
          <Link className="link" to="/recuperar">
            {copy.entrar.forgot}
          </Link>
        </div>
        <PrimaryButton type="submit" busy={login.isPending}>
          {copy.entrar.submit}
        </PrimaryButton>
      </form>
    </section>
  );
}
