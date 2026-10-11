import { useEnterpriseSession } from './use-enterprise'

/** Managed-policy locks resolved for this device.
 *  Outside managed devices nothing is locked (defensive defaults true). */
export const useManagedLocks = (): {
  lockSettings: boolean
  lockProfiles: boolean
} => {
  const session = useEnterpriseSession()
  if (!session?.enabled) {
    return { lockSettings: false, lockProfiles: false }
  }
  return {
    lockSettings: !session.managed.allow_change_settings,
    lockProfiles: !session.managed.allow_edit_profiles,
  }
}
