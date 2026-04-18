import * as guardCli from '@caprail/guard-cli';
import { runArgvTransport } from '@caprail/transport-argv';

export async function runCliProduct({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  homeDirectory,
} = {}) {
  return runArgvTransport({
    argv,
    guard: guardCli,
    stdout,
    stderr,
    env,
    platform,
    homeDirectory,
  });
}
