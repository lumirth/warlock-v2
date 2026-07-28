export type FixtureTerm = 'winter' | 'spring' | 'summer' | 'fall';

export function termListResponse(
  cisapiBase: string,
  year: number,
  terms: FixtureTerm[],
  status = 200,
): Response {
  if (status !== 200) {
    return new Response('<error>not found</error>', {
      status,
      headers: { 'Content-Type': 'application/xml' },
    });
  }

  const base = cisapiBase.replace(/\/+$/, '');
  const entries = terms.map(term => (
    `<term href="${base}/schedule/${year}/${term}.xml">`
    + `${term[0].toUpperCase()}${term.slice(1)} ${year}</term>`
  )).join('');
  return new Response([
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ns2:calendarYear xmlns:ns2="urn:course-explorer" id="${year}">`,
    `<label>${year}</label><terms>${entries}</terms>`,
    '</ns2:calendarYear>',
  ].join(''), {
    status,
    headers: { 'Content-Type': 'application/xml' },
  });
}
