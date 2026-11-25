package com.github.kr328.clash

import com.github.kr328.clash.common.util.intent
import com.github.kr328.clash.core.Clash
import com.github.kr328.clash.core.model.Proxy
import com.github.kr328.clash.design.ProxyDesign
import com.github.kr328.clash.design.model.ProxyState
import com.github.kr328.clash.enterprise.EnterpriseKit
import com.github.kr328.clash.util.withClash
import com.github.kr328.clash.util.withProfile
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

class ProxyActivity : BaseActivity<ProxyDesign>() {
    override suspend fun main() {
        val mode = withClash { queryOverride(Clash.OverrideSlot.Session).mode }
        val names = withClash { queryProxyGroupNames(uiStore.proxyExcludeNotSelectable) }
        val managedProfileName = queryManagedProfileName()
        val states = List(names.size) { ProxyState("?") }
        val unorderedStates = names.indices.map { names[it] to states[it] }.toMap()
        val reloadLock = Semaphore(10)

        val design = ProxyDesign(
            this,
            mode,
            names,
            uiStore,
            managedProfileName
        )

        setContentDesign(design)

        val reloads = arrayOfNulls<Job>(names.size)
        fun reload(index: Int) {
            reloads[index]?.cancel()
            reloads[index] = launch {
                val group = reloadLock.withPermit {
                    withClash {
                        queryProxyGroup(names[index], uiStore.proxySort)
                    }
                }
                val state = states[index]

                state.now = group.now

                design.updateGroup(
                    index,
                    group.proxies,
                    group.type == "Selector",
                    state,
                    unorderedStates
                )
            }
        }
        fun reloadAll() = names.indices.forEach(::reload)
        var wasStopped = false

        reloadAll()

        while (isActive) {
            select<Unit> {
                events.onReceive {
                    when (it) {
                        Event.ActivityStop -> wasStopped = true
                        Event.ProfileLoaded, Event.ProfileChanged, Event.ActivityStart -> {
                            val newNames = withClash {
                                queryProxyGroupNames(uiStore.proxyExcludeNotSelectable)
                            }

                            if (newNames != names || queryManagedProfileName() != managedProfileName) {
                                startActivity(ProxyActivity::class.intent)

                                finish()
                            } else if (it == Event.ProfileLoaded || (it == Event.ActivityStart && wasStopped)) {
                                // Loading new nodes does not necessarily change group names or the company label.
                                reloadAll()
                            }
                            if (it == Event.ActivityStart) wasStopped = false
                        }
                        else -> Unit
                    }
                }
                design.requests.onReceive {
                    when (it) {
                        ProxyDesign.Request.ReLaunch -> {
                            startActivity(ProxyActivity::class.intent)

                            finish()
                        }
                        ProxyDesign.Request.ReloadAll -> {
                            reloadAll()
                        }
                        is ProxyDesign.Request.Reload -> {
                            reload(it.index)
                        }
                        is ProxyDesign.Request.Select -> {
                            withClash {
                                patchSelector(names[it.index], it.name)

                                states[it.index].now = it.name
                            }

                            design.requestRedrawVisible()
                        }
                        is ProxyDesign.Request.UrlTest -> {
                            launch {
                                withClash {
                                    healthCheck(names[it.index])
                                }

                                design.requests.send(ProxyDesign.Request.Reload(it.index))
                            }
                        }
                        is ProxyDesign.Request.PatchMode -> {
                            design.showModeSwitchTips()

                            withClash {
                                val o = queryOverride(Clash.OverrideSlot.Session)

                                o.mode = it.mode

                                patchOverride(Clash.OverrideSlot.Session, o)
                            }
                        }
                    }
                }
            }
        }
    }

    private suspend fun queryManagedProfileName(): String? = withProfile {
        queryActive()?.takeIf { EnterpriseKit.isManaged(it) }
            ?.name?.trim()?.takeIf { it.isNotEmpty() }
    }
}
