import { useEnterpriseSession } from './use-enterprise'

/** Managed-policy locks resolved for this device.
 *  Outside managed devices nothing is locked (defensive defaults true). */
export const useManagedLocks = (): {
  lockProfiles: boolean
} => {
  const session = useEnterpriseSession()
  if (!session?.enabled) {
    return { lockProfiles: false }
  }
  return {
    lockProfiles: !session.managed.allow_edit_profiles,
  }
}
