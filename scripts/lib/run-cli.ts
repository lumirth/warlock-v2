import { pathToFileURL } from 'node:url';

export function runCli(
  moduleUrl: string,
  main: () => void | Promise<void>,
): void {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) return;

  Promise.resolve()
    .then(main)
    .catch(error => {
      if (
        error &&
        typeof error === 'object' &&
        'stderr' in error &&
        typeof error.stderr === 'string'
      ) {
        console.error(error.stderr);
      }
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
