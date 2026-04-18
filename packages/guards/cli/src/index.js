export const packageName = '@caprail/guard-cli';

export {
  getDefaultConfigPaths,
  loadConfig,
  parseConfig,
  resolveConfigPath,
} from './config.js';

export {
  evaluateCommand,
  evaluateToolPolicy,
  findMatchedDenyFlag,
  findMatchedEntry,
  matchesTokenSequence,
  normalizeArgs,
  tokenizePolicyEntry,
} from './matcher.js';

export function getPackageInfo() {
  return {
    name: packageName,
  };
}
