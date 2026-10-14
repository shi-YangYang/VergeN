package com.github.kr328.clash.enterprise

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.github.kr328.clash.MainActivity
import com.github.kr328.clash.R
import com.github.kr328.clash.common.util.intent
import android.widget.TextView
import com.google.android.material.textfield.TextInputEditText
import io.github.vergen.android.enterprise.ApiError
import io.github.vergen.android.enterprise.ErrorKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Login gate. Enterprise deployments ship a managed VPN; anonymous profiles
 * are meaningless, so no anonymous entry point exists here. On success the
 * managed subscriptions bootstrap into the profile list and the app's home
 * task restarts.
 */
class EnterpriseLoginActivity : AppCompatActivity() {
    private lateinit var dingtalk: View
    private lateinit var capabilityStatus: TextView
    private lateinit var capabilityRetry: View
    private lateinit var orDivider: View
    private var capabilitiesJob: Job? = null
    private var dingtalkAvailable = false

    override fun onCreate(savedState: Bundle?) {
        super.onCreate(savedState)
        setContentView(R.layout.activity_enterprise_login)

        val username = findViewById<TextInputEditText>(R.id.enterprise_username_input)
        val password = findViewById<TextInputEditText>(R.id.enterprise_password_input)
        val submit = findViewById<View>(R.id.enterprise_submit)
        val progress = findViewById<View>(R.id.enterprise_progress)
        val error = findViewById<TextView>(R.id.enterprise_error)
        dingtalk = findViewById(R.id.enterprise_dingtalk)
        capabilityStatus = findViewById(R.id.enterprise_dingtalk_status)
        capabilityRetry = findViewById(R.id.enterprise_dingtalk_retry)
        orDivider = findViewById(R.id.enterprise_login_or)

        dingtalk.setOnClickListener {
            startActivity(EnterpriseDingtalkActivity::class.intent)
        }
        capabilityRetry.setOnClickListener {
            checkDingtalkAvailability()
        }

        submit.setOnClickListener {
            val user = username.text.toString().trim()
            val pass = password.text.toString()
            if (user.isEmpty() || pass.isEmpty()) {
                error.text = getString(R.string.enterprise_login_empty)
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }

            error.visibility = View.GONE
            progress.visibility = View.VISIBLE
            submit.isEnabled = false

            lifecycleScope.launch {
                val outcome = withContext(Dispatchers.IO) {
                    try {
                        val subscriptions = EnterpriseKit.coordinator.signIn(user, pass)
                        val synced = EnterpriseKit.syncProfiles()
                        Outcome.Success(subscriptions.size, synced)
                    } catch (e: ApiError) {
                        Outcome.Failure(e)
                    } catch (e: Throwable) {
                        // Any unexpected fault (crypto, binder, parser…) is
                        // surfaced in the UI instead of silently killing the
                        // process; logcat remains the authoritative trace.
                        android.util.Log.e("EnterpriseLogin", "sign-in failed", e)
                        Outcome.Failure(ApiError(ErrorKind.PARSE, 0, e))
                    }
                }

                progress.visibility = View.GONE
                submit.isEnabled = true

                when (outcome) {
                    is Outcome.Success -> {
                        val intent = MainActivity::class.intent
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
                        startActivity(intent)
                        finishAffinity()
                    }

                    is Outcome.Failure -> {
                        error.text = when (outcome.error.kind) {
                            ErrorKind.BAD_CREDENTIALS -> getString(R.string.enterprise_login_bad_credentials)
                            ErrorKind.FORBIDDEN -> getString(R.string.enterprise_login_forbidden)
                            ErrorKind.NETWORK -> getString(R.string.enterprise_login_network)
                            else -> getString(R.string.enterprise_login_error) +
                                " [${outcome.error.kind}/${outcome.error.code}]"
                        }
                        error.visibility = View.VISIBLE
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        checkDingtalkAvailability()
    }

    private fun checkDingtalkAvailability() {
        if (capabilitiesJob?.isActive == true) return

        capabilitiesJob = lifecycleScope.launch {
            dingtalk.isEnabled = dingtalkAvailable
            orDivider.visibility = if (dingtalkAvailable) View.VISIBLE else View.GONE
            capabilityStatus.visibility = View.VISIBLE
            capabilityRetry.visibility = View.GONE

            for (attempt in 0..CAPABILITY_RETRY_DELAYS.size) {
                capabilityStatus.setText(R.string.enterprise_dingtalk_checking)
                val ready = try {
                    withContext(Dispatchers.IO) {
                        EnterpriseKit.apiOrNull()?.capabilities()?.dingtalkQr
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    null
                }

                if (ready != null) {
                    dingtalkAvailable = ready
                    dingtalk.isEnabled = ready
                    orDivider.visibility = if (ready) View.VISIBLE else View.GONE
                    capabilityStatus.visibility = if (ready) View.GONE else View.VISIBLE
                    capabilityStatus.setText(R.string.enterprise_dingtalk_unavailable)
                    capabilityRetry.visibility = if (ready) View.GONE else View.VISIBLE
                    return@launch
                }

                if (attempt < CAPABILITY_RETRY_DELAYS.size) {
                    val wait = CAPABILITY_RETRY_DELAYS[attempt]
                    capabilityStatus.text = getString(
                        R.string.enterprise_dingtalk_retrying,
                        wait / 1000,
                    )
                    delay(wait)
                } else {
                    capabilityStatus.setText(R.string.enterprise_dingtalk_check_failed)
                    capabilityRetry.visibility = View.VISIBLE
                }
            }
        }
    }

    private sealed class Outcome {
        class Success(val count: Int, val synced: Boolean) : Outcome()
        class Failure(val error: ApiError) : Outcome()
    }

    private companion object {
        const val CRASH_KEY = "enterprise_last_error"
        val CAPABILITY_RETRY_DELAYS = longArrayOf(2_000, 4_000, 8_000)
    }
}
