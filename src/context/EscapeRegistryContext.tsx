import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type EscapeHandler = () => void;

type EscapeRegistryValue = {
  registerEscapeHandler: (handler: EscapeHandler) => () => void;
};

const EscapeRegistryContext = createContext<EscapeRegistryValue | null>(null);

export function EscapeRegistryProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const stackRef = useRef<EscapeHandler[]>([]);

  const registerEscapeHandler = useCallback((handler: EscapeHandler) => {
    stackRef.current.push(handler);
    return () => {
      const i = stackRef.current.lastIndexOf(handler);
      if (i >= 0) stackRef.current.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const stack = stackRef.current;
      if (stack.length > 0) {
        e.preventDefault();
        stack[stack.length - 1]!();
        return;
      }
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest('[data-no-escape-nav]')) return;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (el.isContentEditable) return;
      if (location.pathname === '/login') return;
      e.preventDefault();
      navigate(-1);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [navigate, location.pathname]);

  const value = useMemo(
    () => ({ registerEscapeHandler }),
    [registerEscapeHandler],
  );

  return (
    <EscapeRegistryContext.Provider value={value}>{children}</EscapeRegistryContext.Provider>
  );
}

export function useRegisterEscape(handler: EscapeHandler) {
  const ctx = useContext(EscapeRegistryContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!ctx) return;
    return ctx.registerEscapeHandler(() => {
      ref.current();
    });
  }, [ctx]);
}

/** غلاف للمودالات: تسجيل Esc للإغلاق قبل الرجوع في التاريخ */
export function EscapeModalScrim({
  onClose,
  className,
  children,
  ...rest
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  useRegisterEscape(onClose);
  return (
    <div className={className} {...rest}>
      {children}
    </div>
  );
}
