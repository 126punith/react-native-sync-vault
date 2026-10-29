package com.syncvault.core

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

data class OutboundRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String?,
    val bodyFile: File?,
    val contentType: String?,
)

data class HttpResult(
    val status: Int,
    val body: String?,
    val headers: Map<String, String>,
    val networkError: String?,
)

class HttpExecutor {
    @Volatile
    private var client: OkHttpClient = build(30_000)
    private var timeoutMs = 30_000

    @Synchronized
    fun configure(timeoutMs: Int) {
        if (timeoutMs != this.timeoutMs) {
            this.timeoutMs = timeoutMs
            client = build(timeoutMs)
        }
    }

    private fun build(timeoutMs: Int) = OkHttpClient.Builder()
        .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        .connectTimeout(minOf(timeoutMs.toLong(), 15_000), TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false)
        .build()

    /** Blocking; call from Dispatchers.IO. Never throws: transport failures become networkError. */
    fun execute(request: OutboundRequest): HttpResult {
        return try {
            val mediaType = (request.contentType ?: "application/json").toMediaTypeOrNull()
            val method = request.method.uppercase()
            val body: RequestBody? = when {
                request.bodyFile != null -> request.bodyFile.asRequestBody(mediaType)
                request.body != null && method != "GET" && method != "HEAD" -> request.body.toRequestBody(mediaType)
                method == "POST" || method == "PUT" || method == "PATCH" -> ByteArray(0).toRequestBody(mediaType)
                else -> null
            }
            val builder = Request.Builder().url(request.url).method(method, body)
            request.headers.forEach { (k, v) -> builder.header(k, v) }
            client.newCall(builder.build()).execute().use { response ->
                val headers = LinkedHashMap<String, String>()
                response.headers.names().forEach { name -> response.header(name)?.let { headers[name.lowercase()] = it } }
                HttpResult(response.code, response.body?.string(), headers, null)
            }
        } catch (e: Exception) {
            HttpResult(0, null, emptyMap(), e.message ?: e.javaClass.simpleName)
        }
    }

    companion object {
        /** Resolves a relative URL against baseUrl and appends legacy v1 query params. */
        fun buildUrl(baseUrl: String, url: String, queryParams: String?): String {
            val absolute = if (url.startsWith("http://") || url.startsWith("https://")) url
            else baseUrl.trimEnd('/') + "/" + url.trimStart('/')
            if (queryParams.isNullOrEmpty()) return absolute
            val parsed = absolute.toHttpUrlOrNull() ?: return absolute
            val builder = parsed.newBuilder()
            try {
                val o = JSONObject(queryParams)
                o.keys().forEach { k -> builder.addQueryParameter(k, o.optString(k)) }
            } catch (_: Exception) {
                return absolute
            }
            return builder.build().toString()
        }
    }
}
