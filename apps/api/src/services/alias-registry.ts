export type AliasKind = 'subject' | 'gened' | 'delivery' | 'status' | 'difficulty' | 'days' | 'time';

export interface AliasEntry {
  kind: AliasKind;
  canonical: string;
  aliases: string[];
  requiresCue?: boolean;
}

export interface AliasMatch {
  kind: AliasKind;
  canonical: string;
  span: [number, number];
  confidence: number;
  raw: string;
}

// Cue words that indicate gened filter intent
const GENED_CUES = ['gen ed', 'gened', 'gen-ed', 'requirement', 'category'];

export class AliasRegistry {
  private entries: AliasEntry[] = [];

  add(entry: AliasEntry): void {
    this.entries.push(entry);
  }

  addAll(entries: AliasEntry[]): void {
    this.entries.push(...entries);
  }

  match(text: string): AliasMatch[] {
    const normalized = text.toLowerCase();
    const matches: AliasMatch[] = [];
    const consumed = new Set<number>(); // Track consumed character positions

    // Check for cues in the text
    const hasCue = GENED_CUES.some(cue => normalized.includes(cue));

    // Sort entries by longest alias first
    const sortedEntries = [...this.entries].sort((a, b) => {
      const aMax = Math.max(...a.aliases.map(al => al.length));
      const bMax = Math.max(...b.aliases.map(al => al.length));
      return bMax - aMax;
    });

    for (const entry of sortedEntries) {
      // Skip gened entries that require cue if no cue present
      if (entry.requiresCue && !hasCue) {
        continue;
      }

      for (const alias of entry.aliases.sort((a, b) => b.length - a.length)) {
        const aliasLower = alias.toLowerCase();
        let searchStart = 0;

        while (true) {
          const index = normalized.indexOf(aliasLower, searchStart);
          if (index === -1) break;

          // Check if this span is already consumed
          let isConsumed = false;
          for (let i = index; i < index + aliasLower.length; i++) {
            if (consumed.has(i)) {
              isConsumed = true;
              break;
            }
          }

          if (!isConsumed) {
            // Check word boundaries
            const before = index === 0 || /\s/.test(normalized[index - 1]);
            const after = index + aliasLower.length === normalized.length ||
              /\s/.test(normalized[index + aliasLower.length]);

            if (before && after) {
              matches.push({
                kind: entry.kind,
                canonical: entry.canonical,
                span: [index, index + aliasLower.length],
                confidence: 0.9,
                raw: text.slice(index, index + aliasLower.length),
              });

              // Mark this span as consumed
              for (let i = index; i < index + aliasLower.length; i++) {
                consumed.add(i);
              }
            }
          }

          searchStart = index + 1;
        }
      }
    }

    return matches;
  }
}

export function createDefaultRegistry(): AliasRegistry {
  const registry = new AliasRegistry();

  // Time aliases
  registry.addAll([
    { kind: 'time', canonical: 'early', aliases: ['early morning', 'early'] },
    { kind: 'time', canonical: 'morning', aliases: ['morning', 'before noon'] },
    { kind: 'time', canonical: 'midday', aliases: ['midday', 'mid day', 'around noon'] },
    { kind: 'time', canonical: 'afternoon', aliases: ['afternoon', 'after noon'] },
    { kind: 'time', canonical: 'evening', aliases: ['evening', 'night', 'after 5'] },
  ]);

  // Difficulty aliases
  registry.addAll([
    { kind: 'difficulty', canonical: 'easy', aliases: ['easy', 'simple', 'gpa booster', 'easy a', 'not hard'] },
    { kind: 'difficulty', canonical: 'hard', aliases: ['hard', 'difficult', 'challenging', 'tough'] },
  ]);

  // Status aliases
  registry.addAll([
    { kind: 'status', canonical: 'open', aliases: ['open', 'available', 'has seats', 'not full', 'no waitlist'] },
    { kind: 'status', canonical: 'closed', aliases: ['closed', 'full', 'waitlist'] },
  ]);

  // Delivery aliases
  registry.addAll([
    { kind: 'delivery', canonical: 'true', aliases: ['online', 'remote', 'virtual', 'asynchronous', 'async'] },
    { kind: 'delivery', canonical: 'false', aliases: ['in person', 'in-person', 'on campus', 'face to face'] },
  ]);

  // Days aliases
  registry.addAll([
    { kind: 'days', canonical: 'MWF', aliases: ['mwf', 'monday wednesday friday', 'mon wed fri', 'm w f'] },
    { kind: 'days', canonical: 'TR', aliases: ['tr', 'tuesday thursday', 'tue thu', 'tue thur', 't r', 'tuth'] },
    { kind: 'days', canonical: 'MW', aliases: ['mw', 'monday wednesday', 'mon wed'] },
    { kind: 'days', canonical: 'WF', aliases: ['wf', 'wednesday friday', 'wed fri'] },
  ]);

  // GenEd aliases (require cue)
  registry.addAll([
    { kind: 'gened', canonical: 'HUM', aliases: ['humanities', 'humanities and the arts', 'arts'], requiresCue: true },
    { kind: 'gened', canonical: 'NAT', aliases: ['natural sciences', 'nat sci', 'science'], requiresCue: true },
    { kind: 'gened', canonical: 'SBS', aliases: ['social sciences', 'behavioral sciences', 'social and behavioral'], requiresCue: true },
    { kind: 'gened', canonical: 'CS', aliases: ['cultural studies'], requiresCue: true },
    { kind: 'gened', canonical: 'QR', aliases: ['quantitative reasoning', 'quantitative', 'quant'], requiresCue: true },
    { kind: 'gened', canonical: 'NW', aliases: ['non western', 'non-western', 'nonwestern'], requiresCue: true },
    { kind: 'gened', canonical: 'US', aliases: ['us minority', 'minority cultures'], requiresCue: true },
    { kind: 'gened', canonical: 'WCC', aliases: ['western comparative', 'western'], requiresCue: true },
    { kind: 'gened', canonical: 'ACP', aliases: ['advanced composition', 'adv comp', 'writing intensive'], requiresCue: true },
  ]);

  // GenEd codes (no cue required - explicit codes always work)
  registry.addAll([
    { kind: 'gened', canonical: 'HUM', aliases: ['hum', 'humanities', 'humanities and the arts'] },
    { kind: 'gened', canonical: 'NAT', aliases: ['nat', 'nat sci', 'natural sciences'] },
    { kind: 'gened', canonical: 'SBS', aliases: ['sbs', 'social sciences', 'behavioral sciences', 'social and behavioral'] },
    { kind: 'gened', canonical: 'CS', aliases: ['cs gened', 'cs gen ed', 'cultural studies'] }, // "cultural studies" is specific enough
    { kind: 'gened', canonical: 'QR', aliases: ['qr', 'quantitative reasoning'] },
    { kind: 'gened', canonical: 'QR1', aliases: ['qr1', 'qr 1'] },
    { kind: 'gened', canonical: 'QR2', aliases: ['qr2', 'qr 2'] },
    { kind: 'gened', canonical: 'NW', aliases: ['nw', 'non western', 'non-western'] },
    { kind: 'gened', canonical: 'US', aliases: ['us minority', 'minority cultures'] },
    { kind: 'gened', canonical: 'WCC', aliases: ['wcc', 'western comparative'] },
    { kind: 'gened', canonical: 'ACP', aliases: ['acp', 'advanced composition', 'writing intensive'] },
  ]);

  return registry;
}
