import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase, configurationError } from '../../services/platform';
import { useAuth } from './AuthProvider';
import { Feedback } from '../../components/Feedback';
export function AuthPage({ mode = 'login' }: { mode?: 'login' | 'reset' | 'update' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (mode === 'login' && auth.session && auth.profile && !auth.loading)
    return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (configurationError) throw new Error(configurationError);
      if (mode === 'login') {
        z.email().parse(email);
        if (!password) throw new Error('Introduce tu contraseña');
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error)
          throw new Error(
            'No se pudo iniciar sesión. Comprueba tus datos o recupera la contraseña.',
          );
        navigate('/', { replace: true });
      }
      if (mode === 'reset') {
        z.email().parse(email);
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: new URL('/auth/update-password', window.location.origin).href,
        });
        if (error) throw new Error('No se pudo solicitar la recuperación. Inténtalo más tarde.');
        setMessage('Si la cuenta existe, recibirás un enlace para recuperar el acceso.');
      }
      if (mode === 'update') {
        if (!auth.session)
          throw new Error('Abre el enlace de recuperación o invitación de tu correo.');
        if (password.length < 12 || password !== confirmation)
          throw new Error('Usa al menos 12 caracteres y confirma la misma contraseña.');
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw new Error('No se pudo cambiar la contraseña. Solicita un enlace nuevo.');
        setPassword('');
        setConfirmation('');
        setMessage('Contraseña actualizada. Ya puedes entrar en tu espacio.');
      }
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? 'Introduce un email válido.'
          : e instanceof Error
            ? e.message
            : 'No se pudo completar la solicitud',
      );
    } finally {
      setBusy(false);
    }
  }
  const title =
    mode === 'login'
      ? 'Todo empieza\npor tu espacio.'
      : mode === 'reset'
        ? 'Recupera\nel acceso.'
        : 'Una nueva\ncontraseña.';
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Link to="/login" className="brand">
          restaurant<span>platform / workspace</span>
        </Link>
        <div>
          <p className="eyebrow">El oficio de cuidar cada detalle</p>
          <h1>{title}</h1>
          <p>Un espacio para el contenido, las personas y las próximas ideas de tu restaurante.</p>
        </div>
        <small>Gestión privada · Acceso por invitación</small>
      </aside>
      <section className="auth-form">
        <p className="eyebrow">Restaurant Platform</p>
        <h2>
          {mode === 'login'
            ? 'Bienvenido de nuevo'
            : mode === 'reset'
              ? 'Volver a entrar'
              : 'Configura tu acceso'}
        </h2>
        <p>
          {mode === 'login'
            ? 'Inicia sesión con tu cuenta de equipo.'
            : mode === 'reset'
              ? 'Te enviaremos las instrucciones por correo.'
              : 'Usa una contraseña única de al menos 12 caracteres.'}
        </p>
        <form onSubmit={submit}>
          {mode !== 'update' && (
            <label>
              Email
              <input
                autoComplete="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {mode !== 'reset' && (
            <>
              <label>
                Contraseña
                <div className="password-input">
                  <input
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    type={visible ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" aria-pressed={visible} onClick={() => setVisible(!visible)}>
                    {visible ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </label>
              {mode === 'update' && (
                <label>
                  Repite la contraseña
                  <input
                    required
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <Feedback error={error || auth.error || ''} message={message} />
          <button className="primary" disabled={busy || !!configurationError}>
            {busy
              ? 'Un momento…'
              : mode === 'login'
                ? 'Entrar en mi espacio'
                : mode === 'reset'
                  ? 'Enviar instrucciones'
                  : 'Guardar contraseña'}
          </button>
        </form>
        {mode === 'login' ? (
          <Link to="/auth/reset-password">¿Has olvidado tu contraseña?</Link>
        ) : (
          <Link to={mode === 'update' && auth.session ? '/' : '/login'}>
            Volver {mode === 'update' ? 'al espacio' : 'al acceso'}
          </Link>
        )}
        <p className="muted">
          Las cuentas las gestiona el administrador de la plataforma. No hay registro público.
        </p>
      </section>
    </main>
  );
}
