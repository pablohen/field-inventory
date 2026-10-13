import { NumberInput } from '@mantine/core';

/** Whole-number quantity field; Enter confirms. `value` is '' until entered. */
export function QtyInput({
  value,
  onChange,
  onEnter,
  label = 'Quantity',
  min,
  allowNegative = false,
}: {
  value: number | '';
  onChange(v: number | ''): void;
  onEnter(): void;
  label?: string;
  min?: number;
  allowNegative?: boolean;
}) {
  return (
    <NumberInput
      label={label}
      size="lg"
      styles={{ input: { minHeight: 48 } }}
      value={value}
      min={min}
      allowNegative={allowNegative}
      allowDecimal={false}
      inputMode="numeric"
      onChange={(v) => onChange(typeof v === 'number' ? v : '')}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        onEnter();
      }}
    />
  );
}
