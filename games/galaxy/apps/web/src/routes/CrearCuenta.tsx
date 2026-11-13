import { type MeResponse, passwordSchema, referralCodeSchema, type SignupOptions, usernameSchema } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { ME_KEY, errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { ErrorSummary } from '../ui/ErrorSummary';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { PrimaryButton } from '../ui/PrimaryButton';

type Key = 'user' | 'pass' | 'pass2' | 'code';

/** Same rules as the shared registerInput: the server re-validates everything. The code is optional unless required. */
function validate(user: string, pass: string, pass2: string, code: string, codeRequired: boolean): Record<Key, boolean> {
  return {
    user: usernameSchema.safeParse(user).success,
    pass: passwordSchema.safeParse(pass).success && pass.toLowerCase() !== user.toLowerCase(),
    pass2: pass2.length > 0 && pass2 === pass,
    code: code.trim() === '' ? !codeRequired : referralCodeSchema.safeParse(code).success,
  };
}

export function CrearCuenta() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const pass2Ref = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  // An invitation link (`?ref=CODE`) comes with the code already written.
  const [code, setCode] = useState(() => (params.get('ref') ?? '').trim().toUpperCase().slice(0, 20));
  // Whether a code is needed to sign up now (the admins' switch); unknown counts as optional, the server decides.
  const options = useQuery({ queryKey: ['signup-options'], queryFn: () => api<SignupOptions>('/auth/signup-options'), staleTime: 60_000, retry: false });
  const codeRequired = options.data?.referralRequired ?? false;
  // A field shows its error once the user has left it (or tried to submit), then updates while typing.
  const [touched, setTouched] = useState<Record<Key, boolean>>({ user: false, pass: false, pass2: false, code: false });
  const ok = validate(user, pass, pass2, code, codeRequired);
  const touch = (k: Key) => setTouched((t) => ({ ...t, [k]: true }));

  const register = useMutation({
    mutationFn: (body: { username: string; password: string; referralCode?: string }) => api<MeResponse>('/auth/register', { method: 'POST', body }),
    onSuccess: (me) => {
      qc.setQueryData(ME_KEY, me);
      // Onboarding (GDD §12.2): the probe test comes right after the account.
      navigate('/sonda', { replace: true });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ user: true, pass: true, pass2: true, code: true });
    const firstBad = (['user', 'pass', 'pass2', 'code'] as const).find((k) => !ok[k]);
    if (firstBad) {
      ({ user: userRef, pass: passRef, pass2: pass2Ref, code: codeRef })[firstBad].current?.focus();
      return;
    }
    const referralCode = code.trim() ? referralCodeSchema.parse(code) : undefined;
    register.mutate({ username: user, password: pass, ...(referralCode ? { referralCode } : {}) });
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
        <Field
          ref={codeRef}
          label={codeRequired ? copy.crear.code : copy.crear.codeOptional}
          name="referral"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="VEGA-7K2P"
          hint={codeRequired ? copy.crear.codeRequiredHint : copy.crear.codeHint}
          error={touched.code && !ok.code ? copy.crear.codeError : undefined}
          valid={code.trim() !== '' && ok.code}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onBlur={() => code && touch('code')}
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
