import { createServerFn } from '@tanstack/react-start';
import { requireSession } from '#/server/auth/session';
import { defaultReplicaDeps, replicaConfigCore } from './replica-config.server';

export type ReplicaConfig = {
  replicas: {
    name: string; // 'catalog' or a warehouseId
    dbName: string;
    url: string;
    token: string;
    expiresAt: string;
  }[];
  staleWarningMs: number;
};

export const getReplicaConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReplicaConfig> => {
    const session = await requireSession();
    return replicaConfigCore(defaultReplicaDeps(), session);
  },
);
