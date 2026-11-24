import { request } from './http';

/** 与后端 modules/ops 的 OpsOverview 对齐 */
export interface OpsHttpRow {
  route: string;
  method: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface OpsOverview {
  app: { uptimeSeconds: number; rssMb: number; heapMb: number; node: string };
  http: OpsHttpRow[];
  db: { up: boolean; latencyMs: number };
  outbox: { pending: number; failed: number };
  audit: {
    total: number;
    earliest: string | null;
    latest: string | null;
    retentionDays: number;
  };
}

export const opsApi = {
  overview: (): Promise<OpsOverview> =>
    request.get<OpsOverview>('/ops/overview'),
  saveRetention: (retentionDays: number): Promise<{ retentionDays: number }> =>
    request.put('/ops/audit-retention', { retentionDays }),
  cleanup: (): Promise<{ deleted: number; retentionDays: number }> =>
    request.post('/ops/audit-cleanup', {}),
};
