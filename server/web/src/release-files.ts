export function acceptsPackage(name: string, accept: string) {
  return accept
    .split(',')
    .some((extension) => name.toLowerCase().endsWith(extension.toLowerCase()))
}

export function normalizeReleaseVersion(version: string) {
  return version.trim().replace(/^v/, '')
}

export function packageMatchesVersion(name: string, version: string) {
  const normalized = normalizeReleaseVersion(version)
  if (!normalized) return false
  const filename = name.replace(/^vergen/i, 'VergeN')
  // Both current Chinese/ASCII names and earlier Android packages are supported.
  return (
    filename.startsWith(`VergeN_${normalized}_`) ||
    filename.startsWith(`VergeN-${normalized}-android-`)
  )
}
