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

class ApiError(val kind: ErrorKind, val code: Int = 0) : Exception("$kind($code)")

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class RefreshRequest(val refresh_token: String)

@Serializable
data class LoginResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long,
)

@Serializable
data class BootstrapSubscription(val name: String, val url: String)

@Serializable
data class BootstrapResponse(
    @SerialName("config_version") val configVersion: String,
    val subscriptions: List<BootstrapSubscription> = emptyList(),
)

@Serializable
data class HeartbeatRequest(
    val version: String,
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
        val response = request("POST", "/api/v1/auth/login", body)
        response.use { handle(it) }
        val text = response.body?.string().orEmpty()
        return decode(LoginResponse.serializer(), text, response.code)
    }

    @Throws(ApiError::class)
    fun refresh(refreshToken: String): LoginResponse {
        val body = json.encodeToString(RefreshRequest.serializer(), RefreshRequest(refreshToken))
            .toRequestBody(JSON_MEDIA)
        val response = request("POST", "/api/v1/auth/refresh", body)
        response.use { handle(it) }
        return decode(LoginResponse.serializer(), response.body?.string().orEmpty(), response.code)
    }

    @Throws(ApiError::class)
    fun logout(accessToken: String) {
        request("POST", "/api/v1/auth/logout", emptyBody(), accessToken).use { r ->
            // The provider is disposable; a stale session is still a success.
            if (r.code / 100 != 2 && r.code != 401) throw ApiError(ErrorKind.HTTP, r.code)
        }
    }

    @Throws(ApiError::class)
    fun bootstrap(accessToken: String): BootstrapResponse {
        val response = request("GET", "/api/v1/client/bootstrap", token = accessToken)
        response.use { handle(it) }
        return decode(BootstrapResponse.serializer(), response.body?.string().orEmpty(), response.code)
    }

    @Throws(ApiError::class)
    fun heartbeat(
        accessToken: String,
        version: String,
        configVersion: String,
    ): HeartbeatResponse {
        val body = json.encodeToString(HeartbeatRequest.serializer(), HeartbeatRequest(version, configVersion))
            .toRequestBody(JSON_MEDIA)
        val response = request("POST", "/api/v1/client/heartbeat", body, accessToken)
        response.use { handle(it) }
        return decode(HeartbeatResponse.serializer(), response.body?.string().orEmpty(), response.code)
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
