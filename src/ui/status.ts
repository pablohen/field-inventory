import type { ExceptionType } from '#/domain/types';
import type { TokenName } from '#/ui/theme';

export type StatusKind =
  | ExceptionType
  | 'pending'
  | 'synced'
  | 'attention'
  | 'resolved';

export interface StatusColor {
  fill: TokenName;
  text: { light: string; dark: string };
}

const INK = '#1c1917';
const STONE_200 = '#e7e5e4';

/** Status colours are fixed app-wide (spec §3.1); badges must use this. */
export function statusColor(kind: string): StatusColor {
  switch (kind) {
    case 'NEGATIVE_BALANCE':
    case 'attention':
      return { fill: 'danger', text: { light: '#ffffff', dark: INK } };
    case 'synced':
      return { fill: 'ok', text: { light: '#ffffff', dark: INK } };
    case 'resolved':
      return { fill: 'resolved', text: { light: INK, dark: STONE_200 } };
    default:
      return { fill: 'signal', text: { light: INK, dark: INK } };
  }
}
