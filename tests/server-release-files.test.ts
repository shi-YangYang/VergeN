import { describe, expect, it } from 'vitest'

import {
  acceptsPackage,
  packageMatchesVersion,
} from '../server/web/src/release-files'

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
})
