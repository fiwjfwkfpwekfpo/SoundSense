/** Public GitHub repository: the `releases` branch carries updates, `main/plugins` carries the plugin catalog. */
export const REPOSITORY = 'fiwjfwkfpwekfpo/SoundSense';
const RAW = `https://raw.githubusercontent.com/${REPOSITORY}`;
export const RELEASES_URL = `${RAW}/releases`;
/*
 * raw.githubusercontent.com is blocked in some networks (Russia without a VPN). The same signed file
 * is also read through the GitHub API (api.github.com) and the jsDelivr CDN; the signature, not the
 * address, decides whether a manifest is trusted. The API answers first; jsDelivr may lag a few hours.
 */
export function repositoryFileUrls(ref: string, path: string): string[] {
  return [`https://api.github.com/repos/${REPOSITORY}/contents/${path}?ref=${ref}`, `https://fastly.jsdelivr.net/gh/${REPOSITORY}@${ref}/${path}`, `${RAW}/${ref}/${path}`];
}
export const releaseFileUrls = (file: string): string[] => repositoryFileUrls('releases', file);
/** api.github.com returns file contents only when asked for the raw media type. */
export function repositoryHeaders(url: string): Readonly<Record<string, string>> | undefined {
  return /^https:\/\/api\.github\.com\/repos\//.test(url) ? { Accept: 'application/vnd.github.raw' } : undefined;
}
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
