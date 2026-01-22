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
 * Uses word boundary matching to handle partial matches in the query string.
 */
export function expandTopics(query: string): string[] {
  const lowercaseQuery = query.toLowerCase();
  const expansions: string[] = [];

  for (const [key, value] of Object.entries(TOPIC_MAP)) {
    // Match the key as a whole word in the query
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(lowercaseQuery)) {
      expansions.push(value);
    }
  }

  return expansions;
}
