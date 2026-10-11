import { TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { useHandheld } from '../context';

/** Autofocused scan field (disabled with "Starting…" until the backend is ready): Enter submits the trimmed value, clears and refocuses. Empty values are ignored. */
export function ScanInput({
  onScan,
  label = 'Scan',
  placeholder = 'Scan or type, then Enter',
}: {
  onScan(value: string): void;
  label?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  // Lookups need the backend; scanning before it is ready would be rejected.
  const { backend } = useHandheld();
  const starting = backend === null;
  useEffect(() => {
    if (!starting) ref.current?.focus();
  }, [starting]);
  return (
    <TextInput
      ref={ref}
      label={label}
      placeholder={starting ? 'Starting…' : placeholder}
      disabled={starting}
      value={value}
      autoComplete="off"
      autoCapitalize="off"
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || starting) return;
        e.preventDefault();
        const v = value.trim();
        if (v === '') return;
        onScan(v);
        setValue('');
        ref.current?.focus();
      }}
    />
  );
}
