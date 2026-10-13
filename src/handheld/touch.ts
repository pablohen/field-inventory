import type { CSSProperties } from 'react';

/** Spec §6.2: every handheld touch target is at least 48px. Inline so jsdom can read it. */
export const TOUCH: CSSProperties = { minHeight: 48 };
