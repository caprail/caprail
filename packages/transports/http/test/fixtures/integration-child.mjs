/**
 * Integration test fixture: a Node.js child script that accepts a mode argument.
 *
 * Usage: node integration-child.mjs <mode> [value]
 *
 * Modes:
 *   echo <value>  — write value to stdout and exit 0
 *   fail          — write message to stderr and exit 2
 *   bigoutput     — write ~3 MB to stdout in chunks, then exit 0
 *   sleep         — sleep for 30 s (used to trigger timeout)
 */
const [mode, value] = process.argv.slice(2);

function run() {
  if (mode === 'echo') {
    process.stdout.write(`echo:${value ?? ''}\n`);
    process.exit(0);
  }

  if (mode === 'fail') {
    process.stderr.write('child-failed\n');
    process.exit(2);
  }

  if (mode === 'bigoutput') {
    const chunk = Buffer.alloc(65536, 'x'); // 64 KB
    for (let i = 0; i < 50; i++) {          // 50 × 64 KB = 3.2 MB
      process.stdout.write(chunk);
    }
    process.exit(0);
  }

  if (mode === 'sleep') {
    // Sleep effectively forever — integration test will time out before this fires.
    setTimeout(() => process.exit(0), 60_000).unref();
    // Keep the event loop alive so the process doesn't exit immediately.
    const keepAlive = setInterval(() => {}, 1000);
    process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(0); });
    return;
  }

  process.stderr.write(`unknown mode: ${mode}\n`);
  process.exit(3);
}

run();
