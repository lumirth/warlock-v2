import type { RankingScoreComponent } from "../search-types.js";

export function componentTotal(components: RankingScoreComponent[]): number {
  return components.reduce((total, component) => total + component.value, 0);
}

export function appendScoreComponents(
  existing: RankingScoreComponent[] | undefined,
  next: RankingScoreComponent[],
): RankingScoreComponent[] {
  return [...(existing ?? []), ...next];
}

export function scoreComponent(
  name: RankingScoreComponent["name"],
  value: number,
  reason: string,
  evidence?: string[],
): RankingScoreComponent {
  return {
    name,
    value,
    reason,
    evidence: evidence?.filter(Boolean),
  };
}
