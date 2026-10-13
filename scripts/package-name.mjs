const formats = [
  ['.app.tar.gz', '苹果电脑', '升级包'],
  ['.dmg', '苹果电脑', '安装包'],
  ['.exe', 'Windows', '安装及升级包'],
  ['.deb', 'Linux', '安装及升级包'],
  ['.rpm', 'Linux', '安装及升级包'],
  ['.apk', '安卓', '安装包'],
]

export function packageName(file, version, arch) {
  const signature = file.endsWith('.sig') ? '.sig' : ''
  const artifact = signature ? file.slice(0, -signature.length) : file
  const format = formats.find(([extension]) => artifact.endsWith(extension))
  if (!format) throw new Error(`Unsupported package format: ${file}`)
  const [extension, platform, purpose] = format
  const architecture = arch === 'arm64' ? 'ARM64' : arch
  return `VergeN_${version}_${platform}_${architecture}_${purpose}${extension}${signature}`
}

export function releaseAssetName(name) {
  return name
    .replace('苹果电脑', 'macOS')
    .replace('安卓', 'Android')
    .replace('安装及升级包', 'setup')
    .replace('安装包', 'setup')
    .replace('升级包', 'update')
}
