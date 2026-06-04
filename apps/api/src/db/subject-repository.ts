import type { D1Database } from '@cloudflare/workers-types';
import type { Subject } from './types.js';

export function prepareUpsertSubject(db: D1Database, subject: Subject): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO subjects (id, name, college_code, department_code, unit_name,
                          contact_name, contact_title, address_line1, address_line2,
                          phone_number, website_url, description, last_synced)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      college_code = excluded.college_code,
      department_code = excluded.department_code,
      unit_name = excluded.unit_name,
      contact_name = excluded.contact_name,
      contact_title = excluded.contact_title,
      address_line1 = excluded.address_line1,
      address_line2 = excluded.address_line2,
      phone_number = excluded.phone_number,
      website_url = excluded.website_url,
      description = excluded.description,
      last_synced = excluded.last_synced
  `).bind(
    subject.id, subject.name, subject.college_code, subject.department_code,
    subject.unit_name, subject.contact_name, subject.contact_title,
    subject.address_line1, subject.address_line2, subject.phone_number,
    subject.website_url, subject.description, subject.last_synced
  );
}

export async function upsertSubject(db: D1Database, subject: Subject): Promise<void> {
  await prepareUpsertSubject(db, subject).run();
}

export async function getSubject(db: D1Database, id: string): Promise<Subject | null> {
  return db.prepare(
    'SELECT * FROM subjects WHERE id = ?'
  ).bind(id).first<Subject>();
}
