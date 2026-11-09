import { normalizeReleaseVersion } from './release-files'

export function nextReleaseVersion(versions: string[]) {
  let highest = [0n, 0n, 0n]
  for (const version of versions) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].+)?$/.exec(
      normalizeReleaseVersion(version),
    )
    if (!match) continue
    const parts = match.slice(1, 4).map(BigInt)
    if (
      parts[0] > highest[0] ||
      (parts[0] === highest[0] && parts[1] > highest[1]) ||
      (parts[0] === highest[0] &&
        parts[1] === highest[1] &&
        parts[2] > highest[2])
    )
      highest = parts
  }
  const patch = highest[2] + 1n
  const minor = highest[1] + patch / 10n
  return `${highest[0] + minor / 10n}.${minor % 10n}.${patch % 10n}`
}

export async function deleteHistoricalReleases(
  releases: { id: number; version: string }[],
  selectedIDs: number[],
  remove: (id: number) => Promise<unknown>,
) {
  const deleted: number[] = []
  const failed: { id: number; version: string; error: unknown }[] = []
  // The release API lists newest first; bulk deletion excludes the current release.
  for (const release of releases.slice(1)) {
    if (!selectedIDs.includes(release.id)) continue
    try {
      await remove(release.id)
      deleted.push(release.id)
    } catch (error) {
      failed.push({ ...release, error })
    }
  }
  return { deleted, failed }
}
