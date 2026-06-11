import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Document, Element } from 'domhandler';

function decodeXmlText(value: string | undefined): string {
  if (!value) return '';

  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    const normalizedCode = code.toLowerCase();
    if (normalizedCode === 'amp') return '&';
    if (normalizedCode === 'lt') return '<';
    if (normalizedCode === 'gt') return '>';
    if (normalizedCode === 'quot') return '"';
    if (normalizedCode === 'apos') return "'";
    if (normalizedCode.startsWith('#x')) {
      return String.fromCodePoint(parseInt(normalizedCode.slice(2), 16));
    }
    if (normalizedCode.startsWith('#')) {
      return String.fromCodePoint(parseInt(normalizedCode.slice(1), 10));
    }
    return entity;
  });
}

type XmlDocument = Document;
export type XmlElement = Element;

export function parseXmlDocument(xml: string): XmlDocument {
  return parseDocument(xml, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
}

export function localName(node: AnyNode): string {
  const name = 'name' in node ? node.name : '';
  const separator = name.indexOf(':');
  return separator >= 0 ? name.slice(separator + 1) : name;
}

function isXmlElement(node: AnyNode, name?: string): node is XmlElement {
  if (node.type !== 'tag') return false;
  return name ? localName(node) === name : true;
}

export function elementAttr(element: XmlElement | undefined, name: string): string {
  return decodeXmlText(element?.attribs?.[name]).trim();
}

export function elementText(element: XmlElement | undefined): string {
  if (!element) return '';
  return decodeXmlText(DomUtils.textContent(element)).replace(/\s+/g, ' ').trim();
}

export function descendantElements(parent: AnyNode | undefined, name?: string): XmlElement[] {
  if (!parent) return [];
  return DomUtils.findAll((node): node is XmlElement => isXmlElement(node, name), [parent]);
}

export function firstDescendantElement(
  parent: AnyNode | undefined,
  name: string,
): XmlElement | undefined {
  return descendantElements(parent, name)[0];
}

export function firstDescendantText(parent: AnyNode | undefined, name: string): string {
  return elementText(firstDescendantElement(parent, name));
}

export function convertTo24Hour(time12: string): string {
  if (!time12) return '';

  const match = time12.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return time12;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes}`;
}
