import { describe, expect, it } from 'vitest'

import {
  acceptsPackage,
  isSelectableReleaseFile,
  packageMatchesVersion,
  releasePickerOptions,
} from './release-files'

describe('release file selection', () => {
  it('accepts only the file formats for the selected platform and purpose', () => {
    for (const [name, accept, expected] of [
      ['VergeN.exe', '.exe', true],
      ['VergeN.EXE', '.exe', true],
      ['VergeN.apk', '.exe', false],
      ['VergeN.msi', '.exe', false],
      ['VergeN.exe.sig', '.exe', false],
      ['VergeN.dmg', '.dmg,.pkg', true],
      ['VergeN.app.tar.gz', '.app.tar.gz', true],
      ['VergeN.dmg', '.app.tar.gz', false],
      ['VergeN.rpm', '.deb', false],
      ['VergeN.apk', '.apk', true],
    ] as const) {
      expect(acceptsPackage(name, accept), name).toBe(expected)
    }
  })

  it('shows only files belonging to the entered release version', () => {
    const files = [
      'VergeN_0.1.7_Windows_x64_安装包.exe',
      'VergeN_0.1.8_Windows_x64_安装包.exe',
      'VergeN_0.1.8_macOS_ARM64_update.app.tar.gz',
      'VergeN_0.1.8_amd64.deb',
      'vergen-0.1.8-android-arm64-v8a.apk',
      'VergeN_0.1.80_Windows_x64_安装包.exe',
      'VergeN_0.1.8-beta.1_Windows_x64_安装包.exe',
      'VergeN.app.tar.gz',
    ]
    expect(
      files.filter((name) => packageMatchesVersion(name, ' v0.1.8 ')),
    ).toEqual(files.slice(1, 5))
    expect(files.filter((name) => packageMatchesVersion(name, ''))).toEqual([])
    expect(
      files.filter((name) => packageMatchesVersion(name, '0.1.8-beta.1')),
    ).toEqual([files[6]])
  })
  it('does not offer all files, generic binary data or gzip in a strict picker', () => {
    for (const allowed of [
      '.exe',
      '.dmg,.pkg',
      '.deb',
      '.apk',
      '.app.tar.gz',
      '.exe.sig',
      '.deb.sig',
      '.app.tar.gz.sig',
    ]) {
      const options = releasePickerOptions(allowed, '测试')
      const { accept } = options.types[0]
      expect(options.excludeAcceptAllOption).toBe(true)
      expect(Object.values(accept).flat()).toEqual(allowed.split(','))
      expect(Object.keys(accept)).not.toContain('application/octet-stream')
      expect(Object.keys(accept)).not.toContain('application/gzip')
      expect(Object.keys(accept).some((type) => type.includes('*'))).toBe(false)
    }
  })

  it('lists only a matching package or its exact signature in a mixed folder', () => {
    const name = 'VergeN_0.1.8_Windows_x64_安装包.exe'
    const files = [
      name,
      name.replace('0.1.8', '0.1.7'),
      name.replace('.exe', '.apk'),
      name + '.sig',
      name.replace('_x64', '_arm64') + '.sig',
    ]
    expect(
      files.filter((f) => isSelectableReleaseFile(f, '.exe', 'v0.1.8')),
    ).toEqual([name])
    expect(
      files.filter((f) =>
        isSelectableReleaseFile(f, '.exe.sig', 'v0.1.8', name + '.sig'),
      ),
    ).toEqual([name + '.sig'])
  })
})
