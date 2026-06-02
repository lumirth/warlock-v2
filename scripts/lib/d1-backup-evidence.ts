import { readFile } from 'node:fs/promises';

export type D1BackupEvidenceArgs = {
  database?: string;
  backupRef?: string;
  evidenceFile?: string;
  restoreVerified: boolean;
};

function labelValue(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? null;
}

export function hasTimestampBackupRef(value: string | undefined): boolean {
  return Boolean(value) && /^[0-9]{8}T[0-9]{6}Z$/i.test(value!);
}

export async function validateD1BackupEvidence(args: D1BackupEvidenceArgs): Promise<void> {
  const missing = [
    !args.database && '--database',
    !args.backupRef && '--backup-ref',
    !args.evidenceFile && '--evidence-file',
    !args.restoreVerified && '--restore-verified',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing D1 backup preflight requirements: ${missing.join(', ')}`);
  }

  if (!hasTimestampBackupRef(args.backupRef)) {
    throw new Error(`Backup ref must use YYYYMMDDTHHMMSSZ format: ${args.backupRef}`);
  }

  const evidence = await readFile(args.evidenceFile!, 'utf8');
  const backupRef = labelValue(evidence, 'D1 Backup Ref');
  const backupMechanism = labelValue(evidence, 'D1 Backup Mechanism');
  const backupLocation = labelValue(evidence, 'D1 Backup Location') ?? labelValue(evidence, 'D1 Backup Path');
  const restoreDatabase = labelValue(evidence, 'D1 Restore Database');
  const restoreVerified = labelValue(evidence, 'D1 Restore Verified');
  const usesTimeTravel = backupMechanism?.toLowerCase().includes('time travel') ?? false;
  const expectedRestoreDatabase = usesTimeTravel ? args.database! : `${args.database}-restore-${args.backupRef}`;
  const missingEvidence = [
    !evidence.includes(args.database!) && args.database,
    backupRef !== args.backupRef && `D1 Backup Ref: ${args.backupRef}`,
    (!backupLocation || !backupLocation.includes(args.backupRef!)) && `D1 Backup Location containing ${args.backupRef}`,
    restoreDatabase !== expectedRestoreDatabase && `D1 Restore Database: ${expectedRestoreDatabase}`,
    restoreVerified?.toLowerCase() !== 'yes' && 'D1 Restore Verified: yes',
  ].filter(Boolean);

  if (missingEvidence.length > 0) {
    throw new Error(`Evidence file does not mention required backup markers: ${missingEvidence.join(', ')}`);
  }
}
