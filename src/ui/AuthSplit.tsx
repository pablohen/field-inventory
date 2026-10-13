import { Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Wordmark } from '#/ui/Wordmark';

/** Light stone pitch-line colour; legible on `--fi-rail` in both schemes. */
export const PITCH_COLOR = '#d6d3d1';

export function AuthSplit({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="fi-auth">
      <aside className="fi-auth-panel">
        <div className="fi-auth-brand">
          <Wordmark size="lg" />
          <p className="fi-auth-pitch" style={{ color: PITCH_COLOR }}>
            Offline-first stock control. Every movement counted.
          </p>
        </div>
        <div className="fi-stripe fi-auth-stripe" aria-hidden="true" />
      </aside>
      <main className="fi-auth-form">
        <section className="fi-auth-card" aria-label={title}>
          <Title order={2} mb="md">
            {title}
          </Title>
          {children}
        </section>
      </main>
    </div>
  );
}
