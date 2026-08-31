import { DomUtils, parseDocument } from 'htmlparser2';
import type { AnyNode, Element } from 'domhandler';

export type XmlElement = Element;

export function parseXmlDocument(xml: string) {
  return parseDocument(xml, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
}

export function localName(node: AnyNode): string {
  const name = 'name' in node ? node.name : '';
  return name.slice(name.lastIndexOf(':') + 1);
}

export function elementAttr(element: XmlElement | undefined, name: string): string {
  return (element?.attribs[name] ?? '').trim();
}

export function elementText(element: XmlElement | undefined): string {
  return element ? DomUtils.textContent(element).replace(/\s+/g, ' ').trim() : '';
}

export function descendantElements(parent: AnyNode, name: string): XmlElement[] {
  return DomUtils.findAll(
    (node): node is XmlElement => node.type === 'tag' && localName(node) === name,
    [parent],
  );
}

export function convertTo24Hour(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return value;
  const period = match[3].toUpperCase();
  let hour = Number(match[1]) % 12;
  if (period === 'PM') hour += 12;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}
