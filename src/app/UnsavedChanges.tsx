import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useBlocker } from 'react-router-dom';
type Guard = {
  setDirty: (value: boolean) => void;
  confirmLeave: () => boolean;
  beginOperation: () => () => void;
};
const noop: Guard = {
  setDirty: () => {},
  confirmLeave: () => true,
  beginOperation: () => () => {},
};
const Context = createContext<Guard>(noop);
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false),
    operations = useRef(new Set<symbol>());
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const confirmLeave = useCallback(() => {
    if (operations.current.size) {
      window.alert('Espera a que termine la operación antes de cambiar de sección.');
      return false;
    }
    return (
      !dirty.current ||
      window.confirm('Tienes cambios sin guardar. ¿Quieres salir y perder esos cambios locales?')
    );
  }, []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search) &&
      !confirmLeave(),
  );
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current || operations.current.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const beginOperation = useCallback(() => {
    const id = Symbol();
    operations.current.add(id);
    return () => {
      operations.current.delete(id);
    };
  }, []);
  const value = useMemo(
    () => ({ setDirty, confirmLeave, beginOperation }),
    [setDirty, confirmLeave, beginOperation],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useUnsavedChanges = () => useContext(Context);
