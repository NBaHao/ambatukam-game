import type { ReactNode } from "react";

interface Option<T> {
  value: T;
  label: ReactNode;
}

interface Props<T> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Ẩn nhưng vẫn giữ chỗ (không nhảy layout) */
  ghost?: boolean;
}

export function SegmentedControl<T extends string | number>({ options, value, onChange, label, ghost }: Props<T>) {
  return (
    <div className={ghost ? "seg ghost" : "seg"} role="group" aria-label={label} aria-hidden={ghost || undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? "active" : undefined}
          aria-pressed={o.value === value}
          tabIndex={ghost ? -1 : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
