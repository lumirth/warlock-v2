import re

content = open('src/services/extractor.ts').read()

# Restore original uppercase subjectRegex
content = content.replace(
    'const subjectRegex = /\\b([A-Za-z]{2,4})\\b/gi;',
    'const subjectRegex = /\\b([A-Z]{2,4})\\b/g;'
)

# Fix the extract function to move instructors before standalone subjects
extract_fn = """export function extract(text: string): ExtractionResult {
  const hints: Hint[] = [];
  let residual = text;

  // Pass 1: Negations & Strict Entities (Course Codes, CRNs)
  // We extract negations early so they can capture terms before they are removed by aliases
  residual = extractNegations(residual, hints);
  residual = extractCourseCodesAndCrns(residual, hints);

  // Pass 2: Attributes and Aliases (Level, Credits, Days, Time, etc.)
  residual = extractAttributesAndAliases(residual, hints);

  // Pass 3: NLP Patterns (Instructors)
  // We do this before standalone subjects so names like "Fagen" aren't caught as subjects
  residual = extractInstructors(residual, hints);

  // Pass 4: Standalone Subjects & Numbers
  // We do this after aliases and instructors to avoid matching "MWF" or names as subjects
  residual = extractStandaloneEntities(residual, hints);

  // Clean up residual
  residual = residual.replace(/\\s+/g, ' ').trim();

  return { hints, residual };
}"""

content = re.sub(r'export function extract\(text: string\): ExtractionResult \{.*?\}', extract_fn, content, flags=re.DOTALL)

# Add common lowercase subjects to extractStandaloneEntities
entities_fn_pattern = r'function extractStandaloneEntities\(text: string, hints: Hint\[\]\): string \{.*?const subjectRegex = /\\b\(\[A-Z\]\{2,4\}\)\\b/g;'
entities_fn_replacement = r"""function extractStandaloneEntities(text: string, hints: Hint[]): string {
  let residual = text;

  // Standalone Subject Codes (2-4 letters)
  // We allow common lowercase subject codes but require uppercase for others to avoid catching common words
  const commonLowercaseSubjects = ['cs', 'math', 'ece', 'stat', 'phys', 'bio', 'chem', 'econ'];
  const lowercasePattern = `\\\\b(${commonLowercaseSubjects.join('|')})\\\\b`;
  const subjectRegex = new RegExp(`\\\\b([A-Z]{2,4})\\\\b|${lowercasePattern}`, 'gi');"""

content = re.sub(entities_fn_pattern, entities_fn_replacement, content, flags=re.DOTALL)

# Update the loop to use match[1] (uppercase) or match[2] (lowercase match)
loop_pattern = r'while \(\(match = subjectRegex\.exec\(residual\)\) !== null\) \{.*?hints\.push\(\{.*?type: \x27subject\x27,.*?value: match\[1\],.*?\}\);'
loop_replacement = r"""while ((match = subjectRegex.exec(residual)) !== null) {
    const value = (match[1] || match[2]).toUpperCase();
    hints.push({
      type: 'subject',
      value: value,
      metadata: createMetadata('regex', match[0], 0.6),
    });"""

content = re.sub(loop_pattern, loop_replacement, content, flags=re.DOTALL)

with open('src/services/extractor.ts', 'w') as f:
    f.write(content)
