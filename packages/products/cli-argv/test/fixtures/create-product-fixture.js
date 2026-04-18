import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createProductFixture() {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'caprail-cli-product-fixture-'));
  const scriptPath = join(tempDirectory, 'child.mjs');
  const configPath = join(tempDirectory, 'config.yaml');

  writeFileSync(scriptPath, [
    "const [mode, value] = process.argv.slice(2);",
    "if (mode === 'echo') {",
    "  process.stdout.write(`ok:${value || ''}\\n`);",
    "  process.stderr.write('warn:echo\\n');",
    '  process.exit(0);',
    '}',
    "if (mode === 'code') {",
    "  const exitCode = Number.parseInt(value || '0', 10);",
    "  process.stdout.write(`code:${exitCode}\\n`);",
    "  process.stderr.write('warn:code\\n');",
    '  process.exit(Number.isNaN(exitCode) ? 0 : exitCode);',
    '}',
    "process.stderr.write('unexpected mode\\n');",
    'process.exit(3);',
    '',
  ].join('\n'));

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${process.execPath.replace(/\\/g, '\\\\')}"`,
    '    description: Product fixture tool',
    '    allow:',
    '      - echo',
    '      - code',
    '    deny:',
    '      - blocked',
    '',
  ].join('\n'));

  return {
    tempDirectory,
    configPath,
    scriptPath,
  };
}
