import { type PackageFile } from '../../api'

export const PLATFORM_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
}

export type ReleasePlatform = PackageFile['platform']

export const INSTALLER_PLATFORMS: {
  key: ReleasePlatform
  architecture: string
  accept: string
  hint: string
}[] = [
  {
    key: 'windows',
    architecture: 'x64',
    accept: '.exe',
    hint: 'EXE 安装包',
  },
  {
    key: 'macos',
    architecture: 'Apple Silicon',
    accept: '.dmg,.pkg',
    hint: 'DMG / PKG 安装包',
  },
  {
    key: 'linux',
    architecture: 'x64',
    accept: '.deb',
    hint: 'DEB 安装包',
  },
  {
    key: 'android',
    architecture: 'arm64',
    accept: '.apk',
    hint: 'APK 安装包',
  },
]

export const UPDATER_TARGETS: {
  key: string
  platform: ReleasePlatform
  label: string
  accept: string
  hint: string
}[] = [
  {
    key: 'windows-x86_64',
    platform: 'windows',
    label: 'Windows',
    accept: '.exe',
    hint: '安装包及同名 .sig 文件',
  },
  {
    key: 'darwin-aarch64',
    platform: 'macos',
    label: 'macOS',
    accept: '.app.tar.gz',
    hint: '.app.tar.gz 更新包及同名 .sig 文件',
  },
  {
    key: 'linux-x86_64-deb',
    platform: 'linux',
    label: 'Linux · DEB',
    accept: '.deb',
    hint: '.deb 安装包及同名 .sig 文件',
  },
]
