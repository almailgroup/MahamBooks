import { createContext, useContext, type ReactNode } from 'react';
import { Eye } from 'lucide-react';

/**
 * View-only mode, for people who may look at a company but not change it
 * (viewers of a company kept in the cloud). Save buttons in the places where
 * changes are saved (an editor's action bar, the settings save bar, dialog
 * footers) are disabled, with the reason as a hint. The database refuses
 * such changes anyway; this tells people before they try.
 */

export interface ReadOnlyState {
  readOnly: boolean;
  /** Why, in the interface language. */
  reason: string;
}

export const ReadOnlyContext = createContext<ReadOnlyState>({ readOnly: false, reason: '' });

/** Marks where the primary button saves a change. */
const SaveAreaContext = createContext(false);

export function useReadOnly(): ReadOnlyState {
  return useContext(ReadOnlyContext);
}

/** Whether a button of this variant, here, is a save button that view-only mode disables. */
export function useBlockedSave(variant: string): string | null {
  const { readOnly, reason } = useContext(ReadOnlyContext);
  const inSaveArea = useContext(SaveAreaContext);
  return readOnly && inSaveArea && (variant === 'primary' || variant === 'danger') ? reason : null;
}

export function SaveArea({ children }: { children: ReactNode }) {
  return <SaveAreaContext.Provider value>{children}</SaveAreaContext.Provider>;
}

/** "View only", next to disabled save buttons. */
export function ReadOnlyNote({ className }: { className?: string }) {
  const { readOnly, reason } = useReadOnly();
  if (!readOnly) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className ?? ''}`}
      title={reason}
    >
      <Eye className="size-3.5 shrink-0" aria-hidden />
      <span>{reason}</span>
    </span>
  );
}
