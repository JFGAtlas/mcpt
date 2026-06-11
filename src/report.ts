import type { FileResult } from './runner.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = (code: number) => (text: string) =>
  useColor ? `[${code}m${text}[0m` : text;

export const green = color(32);
export const red = color(31);
export const yellow = color(33);
export const dim = color(2);
export const bold = color(1);

export function printFileResult(file: FileResult): void {
  const header = file.serverName ? `${file.path} ${dim(`(${file.serverName})`)}` : file.path;
  console.log(`\n${bold(header)}`);

  if (file.setupError) {
    console.log(`  ${red('✗ setup failed')} ${file.setupError}`);
    return;
  }

  for (const result of file.results) {
    const latency = result.latencyMs >= 1 ? dim(` ${Math.round(result.latencyMs)}ms`) : '';
    const note = result.note ? yellow(` [${result.note}]`) : '';
    if (result.status === 'pass') {
      console.log(`  ${green('✓')} ${result.name}${latency}${note}`);
    } else {
      console.log(`  ${red('✗')} ${result.name}${latency}`);
      for (const failure of result.failures) {
        console.log(`      ${red(failure.split('\n')[0])}`);
        for (const line of failure.split('\n').slice(1)) {
          console.log(`      ${dim(line.trim() ? line : '')}`);
        }
      }
    }
  }
}

export function printSummary(files: FileResult[], elapsedMs: number): boolean {
  const all = files.flatMap((f) => f.results);
  const passed = all.filter((r) => r.status === 'pass').length;
  const failed = all.length - passed;
  const setupErrors = files.filter((f) => f.setupError).length;

  const parts: string[] = [];
  if (passed) parts.push(green(`${passed} passed`));
  if (failed) parts.push(red(`${failed} failed`));
  if (setupErrors) parts.push(red(`${setupErrors} file(s) failed to start`));
  if (parts.length === 0) parts.push(yellow('no tests ran'));

  console.log(`\n${bold('tests:')} ${parts.join(', ')} ${dim(`(${(elapsedMs / 1000).toFixed(2)}s)`)}\n`);
  return failed === 0 && setupErrors === 0 && all.length > 0;
}
