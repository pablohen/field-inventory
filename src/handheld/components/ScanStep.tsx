import { Alert } from '@mantine/core';
import { useState } from 'react';
import { ScanInput } from './ScanInput';

/**
 * A ScanInput with an inline error. `onScan` returns an error message to show,
 * or null when the scan was accepted. A thrown lookup failure is shown too.
 */
export function ScanStep({
  label,
  onScan,
}: {
  label: string;
  onScan(value: string): Promise<string | null> | string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ScanInput
        label={label}
        onScan={async (value) => {
          setError(null);
          try {
            setError(await onScan(value));
          } catch (err) {
            console.error('Scan lookup failed', err);
            setError('Lookup failed. Try again.');
          }
        }}
      />
      {error && <Alert color="red">{error}</Alert>}
    </>
  );
}
