import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export function writeFileAtomicSync(filePath: string, contents: string): void {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const temporaryPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;

  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    const completedDescriptor = descriptor;
    descriptor = undefined;
    closeSync(completedDescriptor);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already be gone.
    }
    throw error;
  }
}
