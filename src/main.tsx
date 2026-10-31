import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/router';
import './styles/global.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="access-error">
        <h1>No se pudo abrir el espacio.</h1>
        <p>Recarga la página. Los cambios ya guardados permanecen en el servidor.</p>
        <button onClick={() => window.location.reload()}>Recargar</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
