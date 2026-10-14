package com.github.kr328.clash.enterprise

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/** DingTalk's native launcher cannot supply the fixed return URI itself. */
class EnterpriseDingtalkReturnActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(
            Intent(this, EnterpriseDingtalkActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("vergen://auth/dingtalk"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        )
        finish()
    }
}
