export const RELEASE_SECTIONS = {
  publish: '发布版本',
  versions: '已有版本',
  files: '文件库',
} as const

export type ReleaseSection = keyof typeof RELEASE_SECTIONS
