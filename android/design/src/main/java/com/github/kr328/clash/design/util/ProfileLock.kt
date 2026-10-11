package com.github.kr328.clash.design.util

import com.github.kr328.clash.service.model.Profile

/**
 * Managed-profile predicate bridge: the design module cannot reach the
 * app's enterprise layer, so the app injects a detector at startup and
 * data-binding layouts call [isManaged] to hide profile controls.
 */
object ProfileLock {
    @Volatile
    var detector: ((Profile) -> Boolean)? = null

    @JvmStatic
    fun isManaged(profile: Profile): Boolean = detector?.invoke(profile) ?: false
}
