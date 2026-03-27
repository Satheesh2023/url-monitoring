/** Re-export check reads (stats / incidents) for routes and scripts. */
export {
  fetchChecksBudgetedStats,
  fetchChecksBudgetedIncidents,
  findLatestCheckPerTarget,
} from "./repo/checks.js";
export type { LatestCheckRow } from "./types.js";
