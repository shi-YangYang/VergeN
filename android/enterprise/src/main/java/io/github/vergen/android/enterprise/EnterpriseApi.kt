package io.github.vergen.android.enterprise

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

enum class ErrorKind { NETWORK, BAD_CREDENTIALS, FORBIDDEN, HTTP, PARSE }

class ApiError(val kind: ErrorKind, val code: Int = 0, val original: Throwable? = null) :
    Exception("$kind($code)", original)

@Serializable
data class CapabilitiesResponse(
    @SerialName("dingtalk_qr") val dingtalkQr: Boolean = false,
)

@Serializable
data class DingtalkQrPollRequest(
    @SerialName("session_id") val sessionId: String,
)

@Serializable
data class DingtalkQrStartResponse(
    @SerialName("session_id") val sessionId: String,
    @SerialName("qr_url") val qrUrl: String,
)

@Serializable
data class DingtalkQrPollResponse(
    val status: String,
    @SerialName("access_token") val accessToken: String? = null,
    @SerialName("refresh_token") val refreshToken: String? = null,
    val user: EnterpriseUser? = null,
)

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class RefreshRequest(val refresh_token: String)

@Serializable
data class EnterpriseUser(
    val username: String? = null,
    @SerialName("display_name") val displayName: String? = null,
)

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
    val user: EnterpriseUser? = null,
)

@Serializable
data class BootstrapSubscription(val name: String, val url: String)

@Serializable
data class BootstrapResponse(
    // The server's bootstrap payload predates config_version drift tracking;
    // version bumps arrive through the heartbeat response instead.
    @SerialName("config_version") val configVersion: String? = null,
    val subscriptions: List<BootstrapSubscription> = emptyList(),
    val user: EnterpriseUser? = null,
)

@Serializable
data class HeartbeatRequest(
    val version: String,
    val os: String,
    val arch: String,
    @SerialName("config_version") val configVersion: String,
)

@Serializable
data class HeartbeatResponse(
    @SerialName("config_version") val configVersion: String? = null,
)

/**
 * Thin client over the vergen-server HTTP API (same contracts the desktop
 * client speaks; see server/internal/api). Callers are expected to serialize
 * calls; authorization failures surface as ApiError(BAD_CREDENTIALS/FORBIDDEN).
 */
class EnterpriseApi(
    private val baseUrl: String,
    client: OkHttpClient? = null,
    private val arch: String = "arm64-v8a",
) {
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private val http = client ?: OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    @Throws(ApiError::class)
    fun login(username: String, password: String): LoginResponse {
        val body = json.encodeToString(LoginRequest.serializer(), LoginRequest(username, password))
            .toRequestBody(JSON_MEDIA)
        return request("POST", "/api/v1/auth/login", body).use { response ->
            handle(response)
            decode(LoginResponse.serializer(), response.body?.string().orEmpty(), response.code)
        }
    }

    @Throws(ApiError::class)
    fun refresh(refreshToken: String): LoginResponse {
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
            .toRequestBody(JSON_MEDIA)
        return request("POST", "/api/v1/auth/refresh", body).use { response ->
            handle(response)
            decode(LoginResponse.serializer(), response.body?.string().orEmpty(), response.code)
        }
    }

    /** Whether the server has DingTalk QR login configured. */
    @Throws(ApiError::class)
    fun capabilities(): CapabilitiesResponse {
        return request("GET", "/api/v1/auth/capabilities").use { response ->
            if (response.code != 200) throw ApiError(ErrorKind.HTTP, response.code)
            decode(CapabilitiesResponse.serializer(), response.body?.string().orEmpty(), 200)
        }
    }

    /** Kotlin 配合桌面端:开一个扫码会话拿 dingtalk qrcode link。 */
    @Throws(ApiError::class)
    fun dingtalkQrStart(): DingtalkQrStartResponse {
        return request("POST", "/api/v1/auth/dingtalk/qr/start", emptyBody()).use { response ->
            if (response.code != 200) throw ApiError(ErrorKind.HTTP, response.code)
            decode(DingtalkQrStartResponse.serializer(), response.body?.string().orEmpty(), 200)
        }
    }

    /** queued → scanned → authorized(token)/failed;应每 1~2 秒轮询一次。 */
    @Throws(ApiError::class)
    fun dingtalkQrPoll(sessionId: String): DingtalkQrPollResponse {
        return request("POST", "/api/v1/auth/dingtalk/qr/poll", dingtalkBody(sessionId)).use { response ->
            if (response.code != 200) throw ApiError(ErrorKind.HTTP, response.code)
            decode(DingtalkQrPollResponse.serializer(), response.body?.string().orEmpty(), 200)
        }
    }

    fun dingtalkQrCancel(sessionId: String) {
        runCatching {
            request("POST", "/api/v1/auth/dingtalk/qr/cancel", dingtalkBody(sessionId))
                .close()
        }
    }

    private fun dingtalkBody(sessionId: String): okhttp3.RequestBody =
        json.encodeToString(
            DingtalkQrPollRequest.serializer(),
            DingtalkQrPollRequest(sessionId),
        ).toRequestBody(JSON_MEDIA)

    fun logout(accessToken: String) {
        request("POST", "/api/v1/auth/logout", emptyBody(), accessToken).use { r ->
            // The provider is disposable; a stale session is still a success.
            if (r.code / 100 != 2 && r.code != 401) throw ApiError(ErrorKind.HTTP, r.code)
        }
    }

    @Throws(ApiError::class)
    fun bootstrap(accessToken: String): BootstrapResponse {
        return request("GET", "/api/v1/client/bootstrap", token = accessToken).use { response ->
            handle(response)
            decode(BootstrapResponse.serializer(), response.body?.string().orEmpty(), response.code)
        }
    }

    @Throws(ApiError::class)
    fun heartbeat(
        accessToken: String,
        version: String,
        configVersion: String,
    ): HeartbeatResponse {
        val body = json.encodeToString(
            HeartbeatRequest.serializer(),
            HeartbeatRequest(version, "android", arch, configVersion),
        ).toRequestBody(JSON_MEDIA)
        return request("POST", "/api/v1/client/heartbeat", body, accessToken).use { response ->
            handle(response)
            decode(HeartbeatResponse.serializer(), response.body?.string().orEmpty(), response.code)
        }
    }

    private fun handle(response: okhttp3.Response): Nothing? = when (response.code) {
        200, 201 -> null
        401 -> throw ApiError(ErrorKind.BAD_CREDENTIALS, 401)
        403 -> throw ApiError(ErrorKind.FORBIDDEN, 403)
        else -> throw ApiError(ErrorKind.HTTP, response.code)
    }

    private fun request(
        method: String,
        path: String,
        body: okhttp3.RequestBody? = null,
        token: String? = null,
    ): okhttp3.Response {
        val builder = Request.Builder()
            .url(baseUrl.trimEnd('/') + path)
        if (token != null) builder.header("Authorization", "Bearer $token")
        builder.method(method, body)
        return try {
            http.newCall(builder.build()).execute()
        } catch (_: java.io.IOException) {
            throw ApiError(ErrorKind.NETWORK)
        }
    }

    private fun <T : Any> decode(
        strategy: DeserializationStrategy<T>,
        text: String,
        code: Int,
    ): T = try {
        json.decodeFromString(strategy, text)
    } catch (_: SerializationException) {
        throw ApiError(ErrorKind.PARSE, code)
    }

    private fun emptyBody(): okhttp3.RequestBody = "{}".toRequestBody(JSON_MEDIA)

    private companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
