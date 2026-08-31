import { elementAttr, elementText, localName, parseXmlDocument, type XmlElement } from './xml-utils.js';

const LABELS = { winter: 'Winter', spring: 'Spring', summer: 'Summer', fall: 'Fall' } as const;
type Term = keyof typeof LABELS;
type Result = { year: number; term: Term; label: string; href: string };

export function parseTermListXml(
  xml: string,
  { requestedYear: year, cisapiBase }: { requestedYear: number; cisapiBase: string },
): Result[] {
  assert(Number.isInteger(year));
  const base = new URL(cisapiBase.endsWith('/') ? cisapiBase : `${cisapiBase}/`);
  assert(base.protocol === 'http:' || base.protocol === 'https:');
  assert(!base.username, !base.password, !base.search, !base.hash);

  const roots = elements(parseXmlDocument(xml).childNodes);
  assert(balanced(xml), roots.length === 1);
  const root = roots[0];
  assert(localName(root) === 'calendarYear', elementAttr(root, 'id') === String(year));
  const children = elements(root.childNodes);
  assert(children.length === 2);
  assert(localName(children[0]) === 'label', elementText(children[0]) === String(year));
  assert(localName(children[1]) === 'terms');
  const terms = elements(children[1].childNodes);
  assert(Boolean(terms.length), terms.every(term => localName(term) === 'term'));

  const seen = new Set<Term>();
  return terms.map(element => parseTerm(element, base, year, seen));
}

function parseTerm(element: XmlElement, base: URL, year: number, seen: Set<Term>): Result {
  const url = new URL(elementAttr(element, 'href'), base);
  const match = url.pathname.match(/\/schedule\/(\d{4})\/(winter|spring|summer|fall)\.xml$/);
  assert(Boolean(match));
  const term = match![2] as Term;
  const label = elementText(element);
  assert(Number(match![1]) === year, !seen.has(term), url.origin === base.origin);
  assert(!url.search, !url.hash);
  assert(url.pathname === `${base.pathname.replace(/\/$/, '')}/schedule/${year}/${term}.xml`);
  assert(label === `${LABELS[term]} ${year}`);
  seen.add(term);
  return { year, term, label, href: url.toString() };
}

function assert(...conditions: boolean[]): void {
  if (conditions.some(condition => !condition)) throw new Error('invalid term list');
}
function elements(nodes: XmlElement['childNodes']): XmlElement[] {
  return nodes.filter((node): node is XmlElement => node.type === 'tag');
}
function balanced(xml: string): boolean {
  const count = (pattern: RegExp) => xml.match(pattern)?.length ?? 0;
  return [
    [/<(?:[\w.-]+:)?calendarYear(?:\s[^>]*)?>/g, /<\/(?:[\w.-]+:)?calendarYear\s*>/g, 1],
    [/<terms(?:\s[^>]*)?>/g, /<\/terms\s*>/g, 1],
    [/<term(?=\s|>)[^>]*>/g, /<\/term\s*>/g, undefined],
  ].every(([open, close, expected]) => count(open as RegExp) === count(close as RegExp)
    && (expected === undefined || count(open as RegExp) === expected));
}
