package io.github.vergen.android.enterprise

/**
 * Holds the concrete [EnterpriseApi] once the deployment URL is known;
 * the server address is shipped at build time so users never type it.
 * The arch carries the heartbeat os/arch report the ops dashboard uses.
 */
class EnterpriseApiHolder(
    private val baseUrl: String,
) {
    val api: EnterpriseApi? = runCatching {
        EnterpriseApi(baseUrl, arch = firstArch())
    }.getOrNull()

    var sessionApi: EnterpriseApi? = api

    private fun firstArch(): String =
        android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"
}
