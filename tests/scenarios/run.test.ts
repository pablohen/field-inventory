import { describe, it } from 'vitest';
import { scenarios as countBeforeLateMove } from './count-before-late-move.scenario';
import { scenarios as countDuringOfflineMove } from './count-during-offline-move.scenario';
import { scenarios as countOverToleranceLateMove } from './count-over-tolerance-late-move.scenario';
import { scenarios as crossWarehouseTransfer } from './cross-warehouse-transfer.scenario';
import { runScenario, type Scenario } from './dsl';
import { scenarios as latePickAfterCount } from './late-pick-after-count.scenario';
import { scenarios as latePickEmptiesBin } from './late-pick-empties-bin.scenario';
import { scenarios as skewedDeviceCount } from './skewed-device-count.scenario';
import { scenarios as twoPickersLastUnits } from './two-pickers-last-units.scenario';

const all: Scenario[] = [
  ...twoPickersLastUnits,
  ...countDuringOfflineMove,
  ...countBeforeLateMove,
  ...countOverToleranceLateMove,
  ...latePickAfterCount,
  ...latePickEmptiesBin,
  ...crossWarehouseTransfer,
  ...skewedDeviceCount,
];

describe('conflict scenarios', () => {
  for (const s of all) it(s.name, () => runScenario(s));
});
