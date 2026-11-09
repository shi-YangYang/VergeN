import { describe, expect, it, vi } from 'vitest'

import {
  deleteHistoricalReleases,
  nextReleaseVersion,
} from '../server/web/src/release-history'

describe('next release version', () => {
  it.each([
    ['0.1.8', '0.1.9'],
    ['0.1.9', '0.2.0'],
    ['0.9.9', '1.0.0'],
    ['9.9.9', '10.0.0'],
    [' v1.2.9 ', '1.3.0'],
    ['1.2.9-beta.1', '1.3.0'],
  ])('increments %s to %s', (previous, next) => {
    expect(nextReleaseVersion([previous])).toBe(next)
  })

  it('uses the highest published version and defaults to 0.0.1', () => {
    expect(nextReleaseVersion(['0.1.1', '0.9.9', '0.1.8'])).toBe('1.0.0')
    expect(nextReleaseVersion([])).toBe('0.0.1')
    expect(nextReleaseVersion(['legacy', '0.1.9'])).toBe('0.2.0')
  })
})

describe('historical release deletion', () => {
  const releases = [
    { id: 4, version: '0.2.1' },
    { id: 3, version: '0.2.0' },
    { id: 2, version: '0.1.9' },
    { id: 1, version: '0.1.8' },
  ]

  it('deletes only selected historical releases, excluding the current version', async () => {
    const remove = vi.fn().mockResolvedValue(null)
    const result = await deleteHistoricalReleases(
      releases,
      [4, 3, 3, 1, 99],
      remove,
    )
    expect(remove.mock.calls).toEqual([[3], [1]])
    expect(result).toEqual({ deleted: [3, 1], failed: [] })
  })

  it('reports failed deletions for retry while preserving successful results', async () => {
    const error = new Error('Connection failed')
    const remove = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(null)
    const result = await deleteHistoricalReleases(releases, [3, 2, 1], remove)
    expect(remove.mock.calls).toEqual([[3], [2], [1]])
    expect(result).toEqual({
      deleted: [2, 1],
      failed: [{ id: 3, version: '0.2.0', error }],
    })
  })
})
