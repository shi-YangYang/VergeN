package com.github.kr328.clash.log

import com.github.kr328.clash.core.model.LogMessage

data class ManagedLogLabel(val group: String, val label: String) {
    fun format(message: LogMessage): LogMessage {
        if (group == label) return message

        val text = message.message
        val formatted = when {
            text.startsWith("[TCP] ") || text.startsWith("[UDP] ") -> formatRoute(text)
            text.startsWith("Patch selector $group -> ") ->
                "Patch selector $label -> " + text.removePrefix("Patch selector $group -> ")
            else -> text
        }
        return if (formatted == text) message else message.copy(message = formatted)
    }

    private fun formatRoute(text: String): String {
        val dialPrefix = text.take(6) + "dial $group "
        if (text.startsWith(dialPrefix)) {
            val remainder = text.removePrefix(dialPrefix)
            if (remainder.startsWith("(match ") || SOURCE_ENDPOINT.containsMatchIn(remainder)) {
                return text.take(6) + "dial $label " + remainder
            }
        }
        if (text.substring(6).startsWith("dial ") || !text.contains(" --> ")) return text

        val using = text.lastIndexOf(" using ")
        if (using < 0) return text
        val chain = text.substring(using + 7)
        if (chain == group || (chain.startsWith("$group[") && chain.endsWith("]"))) {
            return text.substring(0, using + 7) + label + chain.removePrefix(group)
        }
        return text
    }

    companion object {
        private val SOURCE_ENDPOINT = Regex("^(?:[0-9.]+|\\[[0-9a-fA-F:%]+\\]):[0-9]+(?:\\(| --> )")
    }
}
