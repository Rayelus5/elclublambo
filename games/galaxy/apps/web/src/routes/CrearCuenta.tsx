import { type MeResponse, passwordSchema, usernameSchema } from '@galaxy/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ME_KEY, errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ErrorSummary } from '../ui/ErrorSummary';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { PrimaryButton } from '../ui/PrimaryButton';

type Key = 'user' | 'pass' | 'pass2';

/** Same rules as the shared registerInput: the server re-validates everything. */
function validate(user: string, pass: string, pass2: string): Record<Key, boolean> {
  return {
    user: usernameSchema.safeParse(user).success,
    pass: passwordSchema.safeParse(pass).success && pass.toLowerCase() !== user.toLowerCase(),
    pass2: pass2.length > 0 && pass2 === pass,
  };
}

export function CrearCuenta() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const pass2Ref = useRef<HTMLInputElement>(null);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  // A field shows its error once the user has left it (or tried to submit), then updates while typing.
  const [touched, setTouched] = useState<Record<Key, boolean>>({ user: false, pass: false, pass2: false });
  const ok = validate(user, pass, pass2);
  const touch = (k: Key) => setTouched((t) => ({ ...t, [k]: true }));

  const register = useMutation({
    mutationFn: (body: { username: string; password: string }) => api<MeResponse>('/auth/register', { method: 'POST', body }),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me);
      navigate('/', { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ user: true, pass: true, pass2: true });
    const firstBad = (['user', 'pass', 'pass2'] as const).find((k) => !ok[k]);
    if (firstBad) {
      ({ user: userRef, pass: passRef, pass2: pass2Ref })[firstBad].current?.focus();
      return;
    }
    register.mutate({ username: user, password: pass });
  }

  return (
    <section aria-labelledby="h-crear">
      <h2 id="h-crear">{copy.crear.title}</h2>
      <p className="lead">{copy.crear.lead}</p>
      <ErrorSummary message={errorText(register.error, copy.errors)} />
      <form noValidate onSubmit={submit}>
        <Field
          ref={userRef}
          label={copy.fields.username}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="sonda_rayo"
          hint={copy.crear.userHint}
          error={touched.user && !ok.user ? copy.crear.userError : undefined}
          valid={ok.user}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          onBlur={() => user && touch('user')}
        />
        <Field
          ref={passRef}
          label={copy.fields.password}
          name="password"
          autoComplete="new-password"
          password
          hint={copy.crear.passHint}
          error={touched.pass && !ok.pass ? copy.crear.passError : undefined}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onBlur={() => pass && touch('pass')}
        />
        <Field
          ref={pass2Ref}
          label={copy.crear.pass2}
          name="password2"
          autoComplete="new-password"
          type="password"
          error={touched.pass2 && !ok.pass2 ? copy.crear.pass2Error : undefined}
          valid={ok.pass2}
          value={pass2}
          onChange={(e) => setPass2(e.target.value)}
          onBlur={() => pass2 && touch('pass2')}
        />
        <PrimaryButton type="submit" busy={register.isPending} className="mt">
          {copy.crear.submit}
        </PrimaryButton>
      </form>
      <p className="foot">
        <Icon name="shield" />
        <span>{copy.crear.foot}</span>
      </p>
    </section>
  );
}
