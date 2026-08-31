import { coordinateEnrichment } from './enrichment.js';
import { coordinateRmpSync } from './rmp-sync.js';
import type { SyncRouteBindings } from './sync-operations.js';

type EnrichmentApplicationEnv = Pick<
  SyncRouteBindings,
  'DB' | 'RMP_AUTH_TOKEN'
>;

export async function runEnrichment(env: EnrichmentApplicationEnv) {
  const rmp = await coordinateRmpSync(env.DB, env.RMP_AUTH_TOKEN);
  return { rmp, enrichment: await coordinateEnrichment(env.DB) };
}
