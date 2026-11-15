import type { ComponentChildren } from 'preact';

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ComponentChildren;
}

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ id, label, error, hint, children }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div class={`field${error ? ' has-error' : ''}`}>
      <label for={id}>{label}</label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint ? (
        <p class="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p class="error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Banner({ message, onRetry, retryLabel }: { message: string; onRetry?: (() => void) | undefined; retryLabel?: string }) {
  return (
    <div class="banner" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" class="link" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
