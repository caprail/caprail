import { writeFileSync } from 'node:fs';

const [, , mode, ...args] = process.argv;

if (mode === 'capture-env') {
  let stdinData = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    stdinData += chunk;
  });

  await new Promise((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.resume();
  });

  console.log(JSON.stringify({
    pager: process.env.PAGER,
    gitPager: process.env.GIT_PAGER,
    ghPager: process.env.GH_PAGER,
    term: process.env.TERM,
    stdinLength: stdinData.length,
    args,
  }));
  process.exit(0);
}

if (mode === 'echo') {
  console.log(`stdout:${args.join(' ')}`);
  console.error(`stderr:${args.join(' ')}`);
  process.exit(0);
}

if (mode === 'write-marker') {
  writeFileSync(args[0], 'spawned');
  console.log('marker written');
  process.exit(0);
}

if (mode === 'fail') {
  console.error('child failed');
  process.exit(7);
}

console.error(`unknown mode: ${mode}`);
process.exit(64);
