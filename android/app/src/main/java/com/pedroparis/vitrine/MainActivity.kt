package com.pedroparis.vitrine

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * O app é o próprio site do Vitrine rodando num WebView, mais duas peças nativas:
 *  1) pega o login da Riot quando ela devolve para http://localhost/redirect (sem copiar nada);
 *  2) faz as chamadas HTTP para a Riot pelo lado nativo, onde não existe o bloqueio de CORS do navegador.
 * Os cookies da Riot ficam guardados no WebView, então nas próximas vezes o login volta sozinho.
 */
class MainActivity : Activity() {

    companion object {
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val HOME = "$ORIGIN/assets/index.html"
        // A ponte só aceita estes domínios. O resto da internet fica de fora.
        private val ALLOWED = listOf("riotgames.com", "pvp.net", "valorant-api.com")
        private const val BG = "#11151B"
        private const val TAG = "Vitrine"
    }

    private var autotest = false

    /** Endereço sem a parte depois do # e do ?, para nunca registrar tokens. */
    private fun clean(url: String?) = (url ?: "").substringBefore('#').substringBefore('?')

    private lateinit var web: WebView
    private val io = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor(BG)
        window.navigationBarColor = Color.parseColor(BG)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor(BG))
        setContentView(web)

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Algumas páginas de login recusam navegadores embutidos; tira a marca "wv" do nome do navegador.
            userAgentString = userAgentString.replace("; wv", "").replace(Regex(" Version/[\\d.]+"), "")
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "VitrineNative", setOf(ORIGIN)) { _, message, _, _, reply ->
                handle(message.data ?: "", reply)
            }
        }

        autotest = intent?.getBooleanExtra("autotest", false) == true

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.i(TAG, "js: ${m.message()}")
                return true
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (catchLogin(url)) return true
                val host = request.url.host ?: ""
                // Links para fora do login (ex.: rodapé) abrem no navegador do celular.
                if (url.startsWith(ORIGIN) || host.endsWith("riotgames.com") || host.endsWith("riotcdn.net") ||
                    host.endsWith("hcaptcha.com") || host.endsWith("google.com") || host.endsWith("apple.com") ||
                    host.endsWith("facebook.com") || host.endsWith("xbox.com") || host.endsWith("live.com") ||
                    host.endsWith("playstation.com")) return false
                return try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))); true } catch (e: Exception) { false }
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                Log.i(TAG, "página: ${clean(url)}")
                if (isLoginReturn(url)) { view.stopLoading(); catchLogin(url) }
            }

            override fun onPageFinished(view: WebView, url: String) {
                Log.i(TAG, "carregou: ${clean(url)}")
                // No teste automático, registra o que a página de login da Riot mostra.
                if (autotest && (Uri.parse(url).host ?: "").endsWith("riotgames.com")) {
                    main.postDelayed({
                        view.evaluateJavascript("(document.title + ' | ' + (document.body ? document.body.innerText : '')).replace(/\\s+/g,' ').slice(0,300)") {
                            Log.i(TAG, "riot mostra: $it")
                        }
                    }, 6000)
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) Log.w(TAG, "erro ao abrir ${clean(request.url.toString())}: ${error.errorCode} ${error.description}")
            }
        }

        Log.i(TAG, "abrindo (autoteste=$autotest, ponte=${WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)})")
        web.loadUrl(if (autotest) "$HOME?autotest=1" else HOME)
    }

    private fun isLoginReturn(url: String) =
        url.startsWith("http://localhost/redirect") || url.startsWith("http://localhost:80/redirect") ||
            url.startsWith("http://127.0.0.1/redirect")

    /** A Riot devolveu o login: leva o token (que vem depois do #) de volta para o app. */
    private fun catchLogin(url: String): Boolean {
        if (!isLoginReturn(url)) return false
        val fragment = url.substringAfter('#', "")
        Log.i(TAG, "login voltou (com acesso: ${fragment.contains("access_token")})")
        web.loadUrl(if (fragment.isNotEmpty()) "$HOME#$fragment" else "$HOME#erro-login")
        return true
    }

    /** Recebe pedidos do JavaScript do app e faz a chamada HTTP de verdade. */
    private fun handle(data: String, reply: JavaScriptReplyProxy) {
        io.execute {
            val out = JSONObject()
            val t0 = SystemClock.elapsedRealtime()
            var what = ""
            try {
                val req = JSONObject(data)
                out.put("id", req.optInt("id"))
                if (req.optString("type") == "logout") {
                    main.post {
                        CookieManager.getInstance().removeAllCookies(null)
                        CookieManager.getInstance().flush()
                    }
                    out.put("status", 200)
                    out.put("body", "{}")
                } else {
                    val url = URL(req.getString("url"))
                    val host = url.host.lowercase()
                    if (url.protocol != "https" || ALLOWED.none { host == it || host.endsWith(".$it") }) {
                        throw IllegalArgumentException("Endereço não permitido")
                    }
                    what = "${req.optString("method", "GET")} ${url.host}${url.path}"
                    val conn = url.openConnection() as HttpURLConnection
                    conn.requestMethod = req.optString("method", "GET")
                    conn.connectTimeout = 15000
                    conn.readTimeout = 20000
                    req.optJSONObject("headers")?.let { h ->
                        h.keys().forEach { k -> conn.setRequestProperty(k, h.getString(k)) }
                    }
                    if (!req.isNull("body") && req.has("body")) {
                        conn.doOutput = true
                        conn.outputStream.use { it.write(req.getString("body").toByteArray()) }
                    }
                    val code = conn.responseCode
                    val stream = if (code >= 400) conn.errorStream else conn.inputStream
                    val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                    conn.disconnect()
                    out.put("status", code)
                    out.put("body", text)
                    Log.i(TAG, "http $what -> $code em ${SystemClock.elapsedRealtime() - t0}ms (${text.length} caracteres)")
                }
            } catch (e: Throwable) {
                // Qualquer erro (até falta de memória) vira resposta, para o app nunca ficar esperando.
                Log.w(TAG, "http $what falhou: ${e.javaClass.simpleName} ${e.message}")
                out.remove("body")
                out.put("status", 0)
                out.put("error", e.message ?: e.javaClass.simpleName)
            }
            val msg = try { out.toString() } catch (e: Throwable) {
                "{\"id\":${out.optInt("id")},\"status\":0,\"error\":\"Resposta grande demais\"}"
            }
            main.post { try { reply.postMessage(msg) } catch (e: Throwable) { Log.w(TAG, "não consegui responder: ${e.message}") } }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        io.shutdown()
        web.destroy()
        super.onDestroy()
    }
}
