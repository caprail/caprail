export const packageName = '@caprail/guard-cli';

export {
  findExecutable,
  getDefaultConfigPaths,
  loadAndValidateConfig,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  validateConfig,
} from './config.js';

export {
  buildDiscoveryPayload,
  buildExplainPayload,
  buildListPayload,
} from './discovery.js';

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
