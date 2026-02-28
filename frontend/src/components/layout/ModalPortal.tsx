import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface ModalPortalProps {
  children: ReactNode;
}

export function ModalPortal({ children }: ModalPortalProps) {
  if (typeof document === 'undefined') {
    return null;
  }
  return createPortal(children, document.body);
}
