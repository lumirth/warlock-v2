import type { CISAPISubject, CISAPICourse, CISAPICourseDetail } from './types.js';
import { parseSubjectsXml, parseCoursesXml, parseCourseDetailXml } from './parser.js';

export interface CISAPIClientOptions {
  baseUrl: string;
  year: string;
  term: string;
}

export class CISAPIClient {
  private baseUrl: string;
  private year: string;
  private term: string;

  constructor(options: CISAPIClientOptions) {
    this.baseUrl = options.baseUrl;
    this.year = options.year;
    this.term = options.term;
  }

  private async fetch(path: string): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/xml'
      }
    });

    if (!response.ok) {
      throw new Error(`CISAPI request failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    // CISAPI sometimes returns HTML 404 with 200 status
    if (text.includes('<!DOCTYPE html>') || text.includes('<html')) {
      throw new Error('CISAPI returned HTML instead of XML (likely 404)');
    }

    return text;
  }

  async getSubjects(): Promise<CISAPISubject[]> {
    const path = `/schedule/${this.year}/${this.term}.xml`;
    const xml = await this.fetch(path);
    return parseSubjectsXml(xml);
  }

  async getCourses(subjectId: string): Promise<CISAPICourse[]> {
    const path = `/schedule/${this.year}/${this.term}/${subjectId}.xml`;
    const xml = await this.fetch(path);
    return parseCoursesXml(xml, subjectId);
  }

  async getCourseDetail(subjectId: string, courseNumber: string): Promise<CISAPICourseDetail | null> {
    const path = `/schedule/${this.year}/${this.term}/${subjectId}/${courseNumber}.xml?mode=cascade`;
    const xml = await this.fetch(path);
    return parseCourseDetailXml(xml);
  }

  async getCourseWithSections(subjectId: string, courseNumber: string): Promise<CISAPICourseDetail | null> {
    return this.getCourseDetail(subjectId, courseNumber);
  }
}
