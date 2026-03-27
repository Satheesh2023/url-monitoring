/** DB row shapes (JSON/API — booleans as real booleans). */

export type Target = {
  id: string;
  url: string;
  name: string | null;
  pollIntervalSec: number;
  timeoutMs: number;
  maxRedirects: number;
  statusMin: number;
  statusMax: number;
  keyword: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Check = {
  id: string;
  targetId: string;
  checkedAt: Date;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
  bodySnippet: string | null;
};

export type LatestCheckRow = {
  id: string;
  targetId: string;
  checkedAt: Date;
  ok: boolean;
  httpStatus: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
};
