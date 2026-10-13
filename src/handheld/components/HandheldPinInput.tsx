import { PinInput } from '@mantine/core';

/** Four-digit PIN field with 48px+ boxes for gloved thumbs. */
export function HandheldPinInput({
  value,
  onChange,
}: {
  value: string;
  onChange(v: string): void;
}) {
  return (
    <PinInput
      length={4}
      type="number"
      mask
      inputMode="numeric"
      size="lg"
      styles={{ input: { minWidth: 48, minHeight: 48 } }}
      value={value}
      onChange={onChange}
      aria-label="PIN"
    />
  );
}
