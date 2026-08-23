import { useCallback, useEffect, useState } from "react";
import { toastDuration, type ToastKind } from "../state.ts";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Announces what an action did; the identity never changes, so every
 * callback that takes it keeps its own. */
export type Notify = (message: string, kind?: ToastKind) => void;

/** The status bar's message and the timer that clears it. */
export function useToast(): { toast: Toast | null; notify: Notify } {
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback<Notify>((message, kind = "info") => {
    setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message, kind }));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toastDuration(toast.kind));
    return () => clearTimeout(id);
  }, [toast]);

  return { toast, notify };
}
