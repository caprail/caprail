import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createHttpProductFixture() {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'caprail-cli-http-product-'));
  const scriptPath = join(tempDirectory, 'child.mjs');
  const configPath = join(tempDirectory, 'config.yaml');

  writeFileSync(scriptPath, [
    "const [mode, value] = process.argv.slice(2);",
    "if (mode === 'echo') {",
    "  process.stdout.write(`echo:${value || ''}\\n`);",
    "  process.stderr.write('warn:echo\\n');",
    '  process.exit(0);',
    '}',
    "process.stderr.write('bad-mode\\n');",
    'process.exit(2);',
    '',
  ].join('\n'));

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${process.execPath.replace(/\\/g, '\\\\')}"`,
    '    description: Product HTTP fixture',
    '    allow:',
    `      - "${scriptPath.replace(/\\/g, '\\\\')} echo"`,
    '',
  ].join('\n'));

  return {
    tempDirectory,
    configPath,
    scriptPath,
  };
}
