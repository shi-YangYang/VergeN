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

// Avoid generic binary and gzip MIME types: some system pickers expand these
// to unrelated formats. The explicit extensions are also checked on selection.
const mimeBySuffix: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.dmg': 'application/x-apple-diskimage',
  '.pkg': 'application/vnd.apple.installer+xml',
  '.deb': 'application/vnd.debian.binary-package',
  '.apk': 'application/vnd.android.package-archive',
  '.app.tar.gz': 'application/x-vergen-app-update',
}

export function releasePickerOptions(accept: string, description: string) {
  const types: Record<string, string[]> = {}
  for (const suffix of accept.split(',')) {
    const mime =
      mimeBySuffix[suffix] ?? 'application/x-vergen-updater-signature'
    ;(types[mime] ??= []).push(suffix)
  }
  return {
    multiple: false,
    excludeAcceptAllOption: true,
    types: [{ description: description + ' (' + accept + ')', accept: types }],
  }
}

export function isSelectableReleaseFile(
  name: string,
  accept: string,
  version: string,
  expectedName?: string,
) {
  return (
    acceptsPackage(name, accept) &&
    packageMatchesVersion(name, version) &&
    (expectedName === undefined || name === expectedName)
  )
}
