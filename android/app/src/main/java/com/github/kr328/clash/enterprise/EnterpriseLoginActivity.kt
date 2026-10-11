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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Login gate. Enterprise deployments ship a managed VPN; anonymous profiles
 * are meaningless, so no anonymous entry point exists here. On success the
 * managed subscriptions bootstrap into the profile list and the app's home
 * task restarts.
 */
class EnterpriseLoginActivity : AppCompatActivity() {
    override fun onCreate(savedState: Bundle?) {
        super.onCreate(savedState)
        setContentView(R.layout.activity_enterprise_login)

        val username = findViewById<TextInputEditText>(R.id.enterprise_username_input)
        val password = findViewById<TextInputEditText>(R.id.enterprise_password_input)
        val submit = findViewById<View>(R.id.enterprise_submit)
        val progress = findViewById<View>(R.id.enterprise_progress)
        val error = findViewById<TextView>(R.id.enterprise_error)

        findViewById<View>(R.id.enterprise_dingtalk).setOnClickListener {
            startActivity(EnterpriseDingtalkActivity::class.intent)
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

    private sealed class Outcome {
        class Success(val count: Int, val synced: Boolean) : Outcome()
        class Failure(val error: ApiError) : Outcome()
    }

    private companion object {
        const val CRASH_KEY = "enterprise_last_error"
    }
}
