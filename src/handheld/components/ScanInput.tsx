import { TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

/** Autofocused scan field: Enter submits the trimmed value, clears and refocuses. Empty values are ignored. */
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
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <TextInput
      ref={ref}
      label={label}
      placeholder={placeholder}
      value={value}
      autoComplete="off"
      autoCapitalize="off"
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
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
