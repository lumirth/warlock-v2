import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Element } from 'domhandler';

export const COURSE_EXPLORER_TERM_NAMES = [
  'winter',
  'spring',
  'summer',
  'fall',
] as const;

export type CourseExplorerTermName =
  (typeof COURSE_EXPLORER_TERM_NAMES)[number];

export type CourseExplorerTerm = {
  year: number;
  term: CourseExplorerTermName;
  label: string;
  href: string;
};

export type ParseTermListOptions = {
  requestedYear: number;
  cisapiBase: string;
};

const TERM_LABELS: Record<CourseExplorerTermName, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
};

export function parseTermListXml(
  xml: string,
  options: ParseTermListOptions,
): CourseExplorerTerm[] {
  if (!Number.isInteger(options.requestedYear)) {
    throw new Error('Requested term-list year must be an integer');
  }
  assertExpectedTagBalance(xml, options.requestedYear);

  const document = parseDocument(xml, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
  const rootElements = descendantElements(document)
    .filter(element => element.parent === document);
  if (
    rootElements.length !== 1
    || localName(rootElements[0]) !== 'calendarYear'
  ) {
    throw new Error(
      `Invalid term list for ${options.requestedYear}: expected one <calendarYear> root`,
    );
  }

  const root = rootElements[0];
  if (elementAttr(root, 'id') !== String(options.requestedYear)) {
    throw new Error(
      `Invalid term list for ${options.requestedYear}: calendarYear id mismatch`,
    );
  }

  const rootChildren = childElements(root);
  const labels = rootChildren.filter(element => localName(element) === 'label');
  const termContainers = rootChildren.filter(
    element => localName(element) === 'terms',
  );
  if (
    labels.length !== 1
    || elementText(labels[0]) !== String(options.requestedYear)
    || termContainers.length !== 1
    || rootChildren.length !== 2
  ) {
    throw new Error(
      `Invalid term list for ${options.requestedYear}: expected matching label and one direct <terms> container`,
    );
  }

  const termContainer = termContainers[0];
  const directTerms = childElements(termContainer);
  if (
    directTerms.length === 0
    || directTerms.some(element => localName(element) !== 'term')
    || descendantElements(termContainer, 'term').length !== directTerms.length
  ) {
    throw new Error(
      `Invalid term list for ${options.requestedYear}: expected direct <term> entries`,
    );
  }
  if (hasUnexpectedText(root) || hasUnexpectedText(termContainer)) {
    throw new Error(
      `Invalid term list for ${options.requestedYear}: unexpected root text`,
    );
  }

  const allowedTerms = new Set<string>(COURSE_EXPLORER_TERM_NAMES);
  const seenTerms = new Set<CourseExplorerTermName>();
  const parsed: CourseExplorerTerm[] = [];
  const base = validatedCisapiBase(options.cisapiBase);
  const basePath = base.pathname.replace(/\/+$/, '');

  for (const element of directTerms) {
    if (childElements(element).length > 0) {
      throw new Error(
        `Invalid term list for ${options.requestedYear}: nested term content`,
      );
    }

    const href = elementAttr(element, 'href');
    const label = elementText(element);
    if (!href || !label) {
      throw new Error(
        `Invalid term list for ${options.requestedYear}: term href and label are required`,
      );
    }

    const url = validatedTermHref(href, base, basePath, options.requestedYear);
    const match = url.pathname.match(
      /\/schedule\/(\d{4})\/(winter|spring|summer|fall)\.xml$/,
    );
    const year = Number(match?.[1]);
    const term = match?.[2] ?? '';
    if (year !== options.requestedYear || !allowedTerms.has(term)) {
      throw new Error(
        `Invalid term href for requested year ${options.requestedYear}: ${href}`,
      );
    }

    const typedTerm = term as CourseExplorerTermName;
    const expectedPath = (
      `${basePath}/schedule/${options.requestedYear}/${typedTerm}.xml`
    );
    if (url.pathname !== expectedPath) {
      throw new Error(
        `Invalid term href for requested year ${options.requestedYear}: ${href}`,
      );
    }
    const expectedLabel = `${TERM_LABELS[typedTerm]} ${options.requestedYear}`;
    if (label !== expectedLabel) {
      throw new Error(
        `Invalid term label for ${href}: expected "${expectedLabel}"`,
      );
    }
    if (seenTerms.has(typedTerm)) {
      throw new Error(
        `Duplicate ${typedTerm} term for ${options.requestedYear}`,
      );
    }

    seenTerms.add(typedTerm);
    parsed.push({
      year: options.requestedYear,
      term: typedTerm,
      label,
      href: url.toString(),
    });
  }

  return parsed;
}

function childElements(parent: Element): Element[] {
  return parent.childNodes.filter(
    (node): node is Element => node.type === 'tag',
  );
}

function hasUnexpectedText(parent: Element): boolean {
  return parent.childNodes.some(
    node => node.type === 'text' && node.data.trim().length > 0,
  );
}

function localName(node: AnyNode): string {
  const name = 'name' in node ? node.name : '';
  const separator = name.indexOf(':');
  return separator >= 0 ? name.slice(separator + 1) : name;
}

function isElement(node: AnyNode, name?: string): node is Element {
  return node.type === 'tag' && (!name || localName(node) === name);
}

function descendantElements(parent: AnyNode, name?: string): Element[] {
  return DomUtils.findAll(
    (node): node is Element => isElement(node, name),
    [parent],
  );
}

function elementAttr(element: Element, name: string): string {
  return decodeXmlText(element.attribs[name]).trim();
}

function elementText(element: Element): string {
  return decodeXmlText(DomUtils.textContent(element))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlText(value: string | undefined): string {
  if (!value) return '';
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized === 'amp') return '&';
      if (normalized === 'lt') return '<';
      if (normalized === 'gt') return '>';
      if (normalized === 'quot') return '"';
      if (normalized === 'apos') return "'";
      if (normalized.startsWith('#x')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      }
      if (normalized.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      }
      return entity;
    },
  );
}

function assertExpectedTagBalance(xml: string, requestedYear: number): void {
  const markup = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const yearOpenCount = (
    markup.match(/<(?:[\w.-]+:)?calendarYear(?:\s[^>]*)?>/g)?.length ?? 0
  );
  const yearCloseCount = (
    markup.match(/<\/(?:[\w.-]+:)?calendarYear\s*>/g)?.length ?? 0
  );
  const termsOpenCount = markup.match(/<terms(?:\s[^>]*)?>/g)?.length ?? 0;
  const termsCloseCount = markup.match(/<\/terms\s*>/g)?.length ?? 0;
  const termOpenCount = markup.match(/<term(?=\s|>)[^>]*>/g)?.length ?? 0;
  const termCloseCount = markup.match(/<\/term\s*>/g)?.length ?? 0;
  if (
    yearOpenCount !== 1
    || yearCloseCount !== 1
    || termsOpenCount !== 1
    || termsCloseCount !== 1
    || termOpenCount === 0
    || termOpenCount !== termCloseCount
  ) {
    throw new Error(
      `Invalid term list for ${requestedYear}: malformed term markup`,
    );
  }
}

function validatedCisapiBase(value: string): URL {
  let base: URL;
  try {
    base = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch {
    throw new Error('CIS API base URL is invalid');
  }
  if (
    !['http:', 'https:'].includes(base.protocol)
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw new Error('CIS API base URL is invalid');
  }
  return base;
}

function validatedTermHref(
  href: string,
  base: URL,
  basePath: string,
  requestedYear: number,
): URL {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    throw new Error(
      `Invalid term href for requested year ${requestedYear}: ${href}`,
    );
  }

  const expectedPrefix = `${basePath}/schedule/${requestedYear}/`;
  if (
    url.origin !== base.origin
    || url.username
    || url.password
    || url.search
    || url.hash
    || !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new Error(
      `Invalid term href for requested year ${requestedYear}: ${href}`,
    );
  }
  return url;
}
