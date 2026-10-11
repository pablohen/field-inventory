import type { MovementInput } from '#/domain/schemas';
import {
  addToOutbox,
  discardOutbox,
  exportOutbox,
  listOutbox,
  type OutboxStatus,
} from './outbox';
import type { Replica } from './replicas';
import { resetDevice } from './reset';
import type { Sql } from './sql';
import {
  assignedCountTasks,
  assignedPickLists,
  displayedStock,
  findLocation,
  findProduct,
  inTransitTo,
  myOpenExceptions,
} from './stock';
import type { SyncState } from './sync-loop';

export interface LeaderApiDeps {
  outbox: Sql;
  replicas: Map<string, Replica>;
  deviceId: string;
  runSync(): Promise<SyncState>;
  getSyncState(): SyncState;
  closeAll(): Promise<void>;
  now(): Date;
}

/**
 * The methods a leader serves (followers reach them over the channel). A plain
 * object literal: leader dispatch uses `Object.hasOwn`. Arguments and results
 * are structured-cloneable.
 */
export function createLeaderApi(deps: LeaderApiDeps) {
  const replicaFor = (name: string): Replica => {
    const r = deps.replicas.get(name);
    if (!r) throw new Error('UNKNOWN_WAREHOUSE');
    return r;
  };
  return {
    async displayedStock(
      wh: string,
      filter?: { skuId?: string; locationId?: string },
    ) {
      return displayedStock(replicaFor(wh), deps.outbox, wh, filter);
    },
    async findProduct(scan: string) {
      const catalog = deps.replicas.get('catalog');
      if (!catalog) throw new Error('UNKNOWN_CATALOG');
      return findProduct(catalog, scan);
    },
    async findLocation(wh: string, scan: string) {
      return findLocation(replicaFor(wh), scan);
    },
    async assignedPickLists(wh: string, userId: string) {
      return assignedPickLists(replicaFor(wh), userId, deps.outbox);
    },
    async assignedCountTasks(wh: string, userId: string) {
      return assignedCountTasks(replicaFor(wh), userId);
    },
    async myOpenExceptions(wh: string) {
      return myOpenExceptions(replicaFor(wh), deps.deviceId);
    },
    async inTransitTo(wh: string) {
      replicaFor(wh);
      return inTransitTo(deps.replicas, wh, deps.outbox);
    },
    async record(input: MovementInput) {
      await addToOutbox(deps.outbox, input, deps.now());
    },
    async listOutbox(filter?: { warehouseId?: string; status?: OutboxStatus }) {
      return listOutbox(deps.outbox, filter);
    },
    async discardOutbox(id: string) {
      await discardOutbox(deps.outbox, id);
    },
    async exportOutbox() {
      return exportOutbox(deps.outbox);
    },
    async syncNow() {
      return deps.runSync();
    },
    async syncState() {
      return deps.getSyncState();
    },
    async resetDevice() {
      await resetDevice(deps.closeAll);
    },
  };
}

export type LeaderApi = ReturnType<typeof createLeaderApi>;
