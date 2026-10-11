import { describe, it } from 'vitest';
import { scenarios as countDuringOfflineMove } from './count-during-offline-move.scenario';
import { scenarios as crossWarehouseTransfer } from './cross-warehouse-transfer.scenario';
import { runScenario, type Scenario } from './dsl';
import { scenarios as latePickAfterCount } from './late-pick-after-count.scenario';
import { scenarios as skewedDeviceCount } from './skewed-device-count.scenario';
import { scenarios as twoPickersLastUnits } from './two-pickers-last-units.scenario';

const all: Scenario[] = [
  ...twoPickersLastUnits,
  ...countDuringOfflineMove,
  ...latePickAfterCount,
  ...crossWarehouseTransfer,
  ...skewedDeviceCount,
];

describe('conflict scenarios', () => {
  for (const s of all) it(s.name, () => runScenario(s));
});
