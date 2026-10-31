export function Feedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function Loading() {
  return (
    <p role="status" className="loading">
      Cargando tu espacio…
    </p>
  );
}
