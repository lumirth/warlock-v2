export type HistoricalDiscoveryConfig = {
  frontendBase: string;
  cisapiBase: string;
};

export type HistoricalTerm = {
  year: number;
  term: string;
};

export type FetchText = (url: string) => Promise<string>;

export async function discoverHistoricalTerms(options: {
  startYear: number;
  endYear: number;
  termFilter: string | null;
  config: HistoricalDiscoveryConfig;
  fetchText: FetchText;
  log: (message: string) => void;
}): Promise<HistoricalTerm[]> {
  const {
    startYear,
    endYear,
    termFilter,
    config,
    fetchText,
    log,
  } = options;
  log(`\n[DISCOVERY] Fetching all terms for years ${startYear}-${endYear} in parallel...`);

  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  const yearTermsResults = await Promise.all(
    years.map(async (year) => {
      let terms = await getHistoricalTerms(year, config, fetchText);
      if (termFilter) {
        terms = terms.filter(term => term.toLowerCase() === termFilter);
      }
      return terms.map(term => ({ year, term }));
    })
  );

  const allTerms = yearTermsResults.flat();

  log(`[DISCOVERY] Found ${allTerms.length} terms across ${years.length} years`);
  for (const { year, term } of allTerms) {
    log(`  - ${year}/${term}`);
  }

  return allTerms;
}

export async function getHistoricalTerms(
  year: number,
  config: HistoricalDiscoveryConfig,
  fetchText: FetchText,
): Promise<string[]> {
  const ajaxUrl = `${config.frontendBase}/ajax/search/termlist/${year}`;

  try {
    const data = await fetchText(ajaxUrl);
    try {
      const parsed = JSON.parse(data) as Record<string, string>;
      const terms = Object.values(parsed);
      if (terms.length > 0) return terms;
    } catch {
      // Fall through to XML probing when the Course Explorer AJAX endpoint is unavailable.
    }
  } catch {
    // Fall through to XML probing when the faster endpoint is blocked.
  }

  const validTerms: string[] = [];
  for (const term of ['winter', 'spring', 'summer', 'fall']) {
    try {
      const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
      const text = await fetchText(url);
      if (text.includes('<subject') || text.includes('<ns2:')) {
        validTerms.push(term);
      }
    } catch {
      // Missing or inaccessible terms are skipped.
    }
  }

  return validTerms;
}

export async function getHistoricalSubjects(
  year: number,
  term: string,
  config: Pick<HistoricalDiscoveryConfig, 'cisapiBase'>,
  fetchText: FetchText,
): Promise<string[]> {
  const url = `${config.cisapiBase}/schedule/${year}/${term}.xml`;
  try {
    const xml = await fetchText(url);
    const subjects: string[] = [];
    const regex = /<subject id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      subjects.push(match[1]);
    }
    return subjects;
  } catch {
    return [];
  }
}
