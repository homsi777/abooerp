package com.abooerp.dataentry.data

/**
 * Arabic and Persian keyboards emit their own digit characters. They read
 * correctly on screen but are not what number parsers or socket addresses
 * accept, so any numeric field has to fold them back to ASCII as it is
 * typed — otherwise a phone number or IP address silently refuses to work.
 */
fun toWesternDigits(input: String): String = buildString {
    for (c in input) {
        append(
            when (c) {
                in '٠'..'٩' -> '0' + (c - '٠')   // Arabic-Indic
                in '۰'..'۹' -> '0' + (c - '۰')   // Persian
                '٫', '،' -> '.'                        // Arabic decimal / comma
                else -> c
            },
        )
    }
}
