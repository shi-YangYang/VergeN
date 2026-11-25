import type { AnnouncementSession, DeliveredAnnouncement } from './cmds'

const LEGACY = 'vergen:announcement:read:'
const PENDING = 'vergen:announcement:pending:'
const LEGACY_OWNER = 'vergen:announcement:legacy-owner-v1'
const BATCH = 16

type Receipt = Pick<DeliveredAnnouncement, 'id' | 'revision'>
export type SendReceipt = (
  id: number,
  revision: string,
) => Promise<'saved' | 'unknown_revision'>

function key(session: AnnouncementSession, receipt: Receipt, legacy = false) {
  return (
    (legacy ? LEGACY : PENDING) +
    JSON.stringify([
      session.server.replace(/\/+$/, ''),
      legacy ? session.username : session.account,
      receipt.id,
      receipt.revision,
    ])
  )
}

// Legacy receipts contain a username but no immutable employee ID. Only an
// already-restored account can claim its namespace on upgrade. A fresh login
// closes the migration window; replacing a deleted username cannot reopen it.
export function ownsLegacyReceipts(s: AnnouncementSession) {
  const owner = JSON.stringify([
    s.server.replace(/\/+$/, ''),
    s.username,
    s.account,
  ])
  try {
    let bound = localStorage.getItem(LEGACY_OWNER)
    if (bound === null) {
      bound = s.epoch === 1 ? owner : 'closed'
      localStorage.setItem(LEGACY_OWNER, bound)
    }
    return bound === owner
  } catch {
    return false
  }
}

export function locallyConfirmed(s: AnnouncementSession, n: Receipt) {
  try {
    return (
      localStorage.getItem(key(s, n)) !== null ||
      (ownsLegacyReceipts(s) && localStorage.getItem(key(s, n, true)) !== null)
    )
  } catch {
    return false
  }
}

async function deliver(s: AnnouncementSession, n: Receipt, send: SendReceipt) {
  const status = await send(n.id, n.revision)
  if (status === 'saved') {
    try {
      localStorage.removeItem(key(s, n))
      if (ownsLegacyReceipts(s)) localStorage.removeItem(key(s, n, true))
    } catch {
      /* Idempotent if cleanup must wait for storage to become writable. */
    }
  } else {
    // A pre-upgrade revision might not be in the server's publication history.
    // Keep the receipt and retry when this exact version is actually delivered.
    try {
      const pending = key(s, n)
      if (localStorage.getItem(pending) !== null)
        localStorage.setItem(pending, 'deferred')
      const old = key(s, n, true)
      if (ownsLegacyReceipts(s) && localStorage.getItem(old) !== null)
        localStorage.setItem(old, 'deferred')
    } catch {
      /* Leave the existing key intact. */
    }
  }
  return status
}

export async function confirmAnnouncement(
  s: AnnouncementSession,
  n: Receipt,
  send: SendReceipt,
  hide: () => void,
) {
  let queued = false
  try {
    localStorage.setItem(key(s, n), '1')
    queued = true
  } catch {
    /* Fall back to a direct server commit. */
  }
  if (queued) hide()
  try {
    const status = await deliver(s, n, send)
    if (!queued && status !== 'saved')
      throw new Error('Announcement not acknowledged')
    if (!queued) hide()
  } catch (error) {
    if (!queued) throw error
  }
}

export async function flushReceipts(
  s: AnnouncementSession,
  current: Receipt | null,
  send: SendReceipt,
  live: () => boolean,
) {
  const batch: Receipt[] = []
  if (current && locallyConfirmed(s, current)) batch.push(current)
  try {
    const prefix = (kind: string, owner: string) =>
      kind +
      JSON.stringify([s.server.replace(/\/+$/, ''), owner]).slice(0, -1) +
      ','
    const pendingPrefix = prefix(PENDING, s.account)
    const legacyPrefix = ownsLegacyReceipts(s)
      ? prefix(LEGACY, s.username)
      : null
    for (let i = 0; i < localStorage.length && batch.length < BATCH; i++) {
      const k = localStorage.key(i)
      if (!k || localStorage.getItem(k) === 'deferred') continue
      const kind = k.startsWith(pendingPrefix)
        ? PENDING
        : legacyPrefix && k.startsWith(legacyPrefix)
          ? LEGACY
          : null
      if (kind === null) continue
      try {
        const a: unknown = JSON.parse(k.slice(kind.length))
        if (!Array.isArray(a) || a.length !== 4) continue
        const [, , id, revision] = a
        if (
          typeof id !== 'number' ||
          !Number.isSafeInteger(id) ||
          id <= 0 ||
          typeof revision !== 'string' ||
          !/^[a-f0-9]{64}$/.test(revision)
        )
          continue
        if (!batch.some((n) => n.id === id && n.revision === revision))
          batch.push({ id, revision })
      } catch {
        /* Malformed entries are never sent. */
      }
    }
  } catch {
    /* Storage may be unavailable. */
  }
  for (const n of batch) {
    if (!live()) return
    try {
      await deliver(s, n, send)
    } catch {
      return
    }
  }
}
