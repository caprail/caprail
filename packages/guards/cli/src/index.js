export const packageName = '@caprail/guard-cli';

export {
  getDefaultConfigPaths,
  loadConfig,
  parseConfig,
  resolveConfigPath,
} from './config.js';

export function getPackageInfo() {
  return {
    name: packageName,
  };
}
