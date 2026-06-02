export interface TopicGroup {
  expansion: string;
  aliases: string[];
}

export const TOPIC_GROUPS: TopicGroup[] = [
  {
    expansion: 'artificial intelligence',
    aliases: ['ai', 'a i', 'artificial intelligence', 'artifical intelligence'],
  },
  {
    expansion: 'machine learning',
    aliases: ['ml', 'm l', 'machine learning', 'machne learning', 'deep learning'],
  },
  {
    expansion: 'human computer interaction',
    aliases: ['hci', 'human computer interaction', 'human-computer interaction', 'ux', 'user experience'],
  },
  {
    expansion: 'database',
    aliases: ['db', 'dbs', 'database', 'databases', 'database systems', 'data base'],
  },
  {
    expansion: 'cybersecurity',
    aliases: ['cyber', 'cyber security', 'cybersecurity', 'computer security', 'network security'],
  },
  {
    expansion: 'software engineering',
    aliases: ['swe', 'software engineering', 'software dev', 'software development'],
  },
  {
    expansion: 'operating systems',
    aliases: ['os', 'operating systems'],
  },
  {
    expansion: 'distributed systems',
    aliases: ['dist', 'distributed', 'distributed systems'],
  },
  {
    expansion: 'natural language processing',
    aliases: ['nlp', 'natural language processing'],
  },
  {
    expansion: 'natural language understanding',
    aliases: ['nlu', 'natural language understanding'],
  },
  {
    expansion: 'cryptography',
    aliases: ['crypto', 'cryptography'],
  },
  {
    expansion: 'computer graphics',
    aliases: ['graphics', 'computer graphics'],
  },
  {
    expansion: 'visualization',
    aliases: ['viz', 'visualization', 'data visualization'],
  },
  {
    expansion: 'data science',
    aliases: ['ds', 'data sci', 'data science'],
  },
  {
    expansion: 'statistics',
    aliases: ['stats', 'statistics'],
  },
  {
    expansion: 'c++ programming',
    aliases: ['c++', 'cpp', 'c plus plus'],
  },
  {
    expansion: 'virtual reality',
    aliases: ['vr', 'virtual reality'],
  },
  {
    expansion: 'augmented reality',
    aliases: ['ar', 'augmented reality'],
  },
  {
    expansion: 'user interface',
    aliases: ['ui', 'user interface'],
  },
];

export const TOPIC_MAP: Record<string, string> = Object.fromEntries(
  TOPIC_GROUPS.flatMap(group => group.aliases.map(alias => [alias, group.expansion]))
);

export function expandTopics(query: string): string[] {
  const expansions = new Set<string>();

  for (const group of TOPIC_GROUPS) {
    if (matchesTopicGroup(query, group)) {
      expansions.add(group.expansion);
    }
  }

  return Array.from(expansions);
}

function matchesTopicGroup(query: string, group: TopicGroup): boolean {
  for (const alias of group.aliases) {
    if (matchesAliasExactly(query, alias) || matchesAliasFuzzily(query, alias)) {
      return true;
    }
  }

  return false;
}

function matchesAliasExactly(query: string, alias: string): boolean {
  return new RegExp(topicBoundaryPattern(alias), 'i').test(query);
}

function topicBoundaryPattern(alias: string): string {
  const parts = alias.split(/\s+/).filter(Boolean).map(escapeRegex);
  const body = parts.join('[\\s/_-]+');
  return `(?:^|[^a-z0-9+#])${body}(?=$|[^a-z0-9+#])`;
}

function matchesAliasFuzzily(query: string, alias: string): boolean {
  if (!shouldFuzzyMatchAlias(alias)) {
    return false;
  }

  const aliasWords = alias.toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = tokenize(query);
  if (tokens.length < aliasWords.length) {
    return false;
  }

  const aliasText = aliasWords.join(' ');
  const maxDistance = maxFuzzyTopicDistance(aliasText);
  for (let start = 0; start <= tokens.length - aliasWords.length; start++) {
    const candidate = tokens.slice(start, start + aliasWords.length).join(' ');
    if (boundedLevenshtein(aliasText, candidate, maxDistance) <= maxDistance) {
      return true;
    }
  }

  return false;
}

function tokenize(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function shouldFuzzyMatchAlias(alias: string): boolean {
  const compactLength = alias.replace(/\s+/g, '').length;
  return compactLength >= 10;
}

function maxFuzzyTopicDistance(alias: string): number {
  const compactLength = alias.replace(/\s+/g, '').length;
  return compactLength >= 16 ? 2 : 1;
}

function boundedLevenshtein(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i++) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [previous, current] = [current, previous];
  }

  return previous[right.length];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
