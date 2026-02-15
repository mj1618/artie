"use client";

import { ToastItem } from "@/components/ui/Toast";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          type={t.type}
          message={t.message}
          onDismiss={() => onDismiss(t.id)}
        />
      ))}
    </div>
  );
}
