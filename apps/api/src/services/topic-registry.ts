export const TOPIC_MAP: Record<string, string> = {
  'ai': 'artificial intelligence',
  'ml': 'machine learning',
  'os': 'operating systems',
  'ui': 'user interface',
  'vr': 'virtual reality',
  'ar': 'augmented reality',
  'db': 'database',
  'hci': 'human computer interaction',
  'nlp': 'natural language processing',
  'crypto': 'cryptography',
  'sec': 'security',
  'swe': 'software engineering',
  'dist': 'distributed systems',
  'graphics': 'computer graphics',
  'viz': 'visualization',
  'ds': 'data science',
  'stats': 'statistics',
};

/**
 * Expands short topic names/synonyms into their full versions.
 * Returns an array of expansion terms.
 */
export function expandTopics(query: string): string[] {
  const words = query.toLowerCase().split(/\W+/);
  const expansions: string[] = [];

  for (const word of words) {
    if (TOPIC_MAP[word]) {
      expansions.push(TOPIC_MAP[word]);
    }
  }

  return expansions;
}
