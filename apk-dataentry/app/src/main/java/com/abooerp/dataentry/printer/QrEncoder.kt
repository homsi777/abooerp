package com.abooerp.dataentry.printer

/**
 * Minimal QR encoder — byte mode, error-correction level M, versions 1-6
 * (up to 106 bytes), which covers receipt/tracking numbers comfortably.
 *
 * Written in-app rather than pulled from a library because the label
 * printer cannot draw QR codes itself: the XP-350BM firmware silently
 * ignores TSPL's own QRCODE command (verified on the real unit — it feeds a
 * completely blank label), so the only way to get a QR onto a label is to
 * generate the modules here and paint them into the label bitmap.
 */
object QrEncoder {

    private val EXP = IntArray(512)
    private val LOG = IntArray(256)

    init {
        var x = 1
        for (i in 0 until 255) {
            EXP[i] = x
            LOG[x] = i
            x = x shl 1
            if (x and 0x100 != 0) x = x xor 0x11D
        }
        for (i in 255 until 512) EXP[i] = EXP[i - 255]
    }

    /** Per version (1-6) at ECC level M: data codewords, EC codewords per
     *  block, block count. */
    private val SPEC = arrayOf(
        intArrayOf(16, 10, 1),
        intArrayOf(28, 16, 1),
        intArrayOf(44, 26, 1),
        intArrayOf(64, 18, 2),
        intArrayOf(86, 24, 2),
        intArrayOf(108, 16, 4),
    )

    /** Alignment-pattern centre per version; version 1 has none. */
    private val ALIGN = intArrayOf(0, 18, 22, 26, 30, 34)

    /**
     * Returns the finished module grid as `[row][column]`, `true` = dark.
     * The caller is responsible for the 4-module quiet zone around it.
     */
    fun encode(text: String): Array<BooleanArray> {
        val content = text.toByteArray(Charsets.UTF_8)
        val version = (1..6).firstOrNull { content.size <= SPEC[it - 1][0] - 2 }
            ?: throw IllegalArgumentException("QR content too long (max 106 bytes)")

        val dataCw = SPEC[version - 1][0]
        val ecPerBlock = SPEC[version - 1][1]
        val numBlocks = SPEC[version - 1][2]

        val bits = ArrayList<Int>()
        appendBits(bits, 4, 4)                  // byte mode
        appendBits(bits, content.size, 8)       // char count (8 bits for v1-9)
        for (b in content) appendBits(bits, b.toInt() and 0xFF, 8)
        val capacityBits = dataCw * 8
        var terminator = 0
        while (terminator < 4 && bits.size < capacityBits) {
            bits.add(0)
            terminator++
        }
        while (bits.size % 8 != 0) bits.add(0)

        val data = ByteArray(dataCw)
        for (i in bits.indices) {
            if (bits[i] != 0) {
                data[i / 8] = (data[i / 8].toInt() or (1 shl (7 - i % 8))).toByte()
            }
        }
        var alt = true
        for (i in bits.size / 8 until dataCw) {
            data[i] = if (alt) 0xEC.toByte() else 0x11.toByte()
            alt = !alt
        }

        val blockLen = dataCw / numBlocks
        val dataBlocks = Array(numBlocks) { b -> data.copyOfRange(b * blockLen, (b + 1) * blockLen) }
        val ecBlocks = Array(numBlocks) { b -> ecBytes(dataBlocks[b], ecPerBlock) }

        val interleaved = ArrayList<Byte>()
        for (i in 0 until blockLen) for (b in 0 until numBlocks) interleaved.add(dataBlocks[b][i])
        for (i in 0 until ecPerBlock) for (b in 0 until numBlocks) interleaved.add(ecBlocks[b][i])

        val size = version * 4 + 17
        val modules = Array(size) { BooleanArray(size) }
        val function = Array(size) { BooleanArray(size) }
        drawFunctionPatterns(modules, function, size, version)
        drawCodewords(modules, function, size, interleaved.toByteArray())

        var best: Array<BooleanArray>? = null
        var bestScore = Int.MAX_VALUE
        for (mask in 0 until 8) {
            val candidate = Array(size) { modules[it].copyOf() }
            applyMask(candidate, function, size, mask)
            drawFormatBits(candidate, size, mask)
            val score = penalty(candidate, size)
            if (score < bestScore) {
                bestScore = score
                best = candidate
            }
        }
        return best!!
    }

    private fun appendBits(bits: MutableList<Int>, value: Int, length: Int) {
        for (i in length - 1 downTo 0) bits.add((value shr i) and 1)
    }

    private fun mul(a: Int, b: Int): Int = if (a == 0 || b == 0) 0 else EXP[LOG[a] + LOG[b]]

    private fun generatorPoly(degree: Int): IntArray {
        var g = intArrayOf(1)
        for (i in 0 until degree) {
            val next = IntArray(g.size + 1)
            for (j in g.indices) {
                next[j] = next[j] xor g[j]
                next[j + 1] = next[j + 1] xor mul(g[j], EXP[i])
            }
            g = next
        }
        return g
    }

    private fun ecBytes(data: ByteArray, ecLength: Int): ByteArray {
        val gen = generatorPoly(ecLength)
        val res = IntArray(data.size + ecLength)
        for (i in data.indices) res[i] = data[i].toInt() and 0xFF
        for (i in data.indices) {
            val coef = res[i]
            if (coef != 0) {
                for (j in gen.indices) res[i + j] = res[i + j] xor mul(gen[j], coef)
            }
        }
        return ByteArray(ecLength) { res[data.size + it].toByte() }
    }

    private fun setFunction(
        modules: Array<BooleanArray>,
        function: Array<BooleanArray>,
        size: Int,
        x: Int,
        y: Int,
        dark: Boolean,
    ) {
        if (x < 0 || x >= size || y < 0 || y >= size) return
        modules[y][x] = dark
        function[y][x] = true
    }

    private fun drawFunctionPatterns(
        modules: Array<BooleanArray>,
        function: Array<BooleanArray>,
        size: Int,
        version: Int,
    ) {
        for (i in 0 until size) {
            setFunction(modules, function, size, 6, i, i % 2 == 0)
            setFunction(modules, function, size, i, 6, i % 2 == 0)
        }
        for ((cx, cy) in listOf(3 to 3, size - 4 to 3, 3 to size - 4)) {
            for (dy in -4..4) for (dx in -4..4) {
                val dist = maxOf(Math.abs(dx), Math.abs(dy))
                setFunction(modules, function, size, cx + dx, cy + dy, dist != 2 && dist != 4)
            }
        }
        if (version >= 2) {
            val a = ALIGN[version - 1]
            for (dy in -2..2) for (dx in -2..2) {
                setFunction(modules, function, size, a + dx, a + dy, maxOf(Math.abs(dx), Math.abs(dy)) != 1)
            }
        }
        // Reserve (and later overwrite) the two format-information strips.
        for (i in 0..5) setFunction(modules, function, size, 8, i, false)
        setFunction(modules, function, size, 8, 7, false)
        setFunction(modules, function, size, 8, 8, false)
        setFunction(modules, function, size, 7, 8, false)
        for (i in 9 until 15) setFunction(modules, function, size, 14 - i, 8, false)
        for (i in 0 until 8) setFunction(modules, function, size, size - 1 - i, 8, false)
        for (i in 8 until 15) setFunction(modules, function, size, 8, size - 15 + i, false)
        setFunction(modules, function, size, 8, size - 8, true)
    }

    private fun drawCodewords(
        modules: Array<BooleanArray>,
        function: Array<BooleanArray>,
        size: Int,
        data: ByteArray,
    ) {
        var i = 0
        var right = size - 1
        while (right >= 1) {
            if (right == 6) right = 5
            for (vert in 0 until size) {
                for (j in 0 until 2) {
                    val x = right - j
                    val upward = ((right + 1) and 2) == 0
                    val y = if (upward) size - 1 - vert else vert
                    if (!function[y][x] && i < data.size * 8) {
                        modules[y][x] = ((data[i ushr 3].toInt() shr (7 - (i and 7))) and 1) != 0
                        i++
                    }
                }
            }
            right -= 2
        }
    }

    private fun applyMask(modules: Array<BooleanArray>, function: Array<BooleanArray>, size: Int, mask: Int) {
        for (y in 0 until size) for (x in 0 until size) {
            if (function[y][x]) continue
            val invert = when (mask) {
                0 -> (x + y) % 2 == 0
                1 -> y % 2 == 0
                2 -> x % 3 == 0
                3 -> (x + y) % 3 == 0
                4 -> (x / 3 + y / 2) % 2 == 0
                5 -> (x * y) % 2 + (x * y) % 3 == 0
                6 -> ((x * y) % 2 + (x * y) % 3) % 2 == 0
                else -> ((x + y) % 2 + (x * y) % 3) % 2 == 0
            }
            if (invert) modules[y][x] = !modules[y][x]
        }
    }

    private fun drawFormatBits(modules: Array<BooleanArray>, size: Int, mask: Int) {
        // ECC level M contributes 0 in the high bits, so the data is just the mask.
        var rem = mask
        for (i in 0 until 10) rem = (rem shl 1) xor ((rem shr 9) * 0x537)
        val bits = ((mask shl 10) or rem) xor 0x5412

        fun bit(i: Int) = ((bits shr i) and 1) != 0

        for (i in 0..5) modules[i][8] = bit(i)
        modules[7][8] = bit(6)
        modules[8][8] = bit(7)
        modules[8][7] = bit(8)
        for (i in 9 until 15) modules[8][14 - i] = bit(i)
        for (i in 0 until 8) modules[8][size - 1 - i] = bit(i)
        for (i in 8 until 15) modules[size - 15 + i][8] = bit(i)
        modules[size - 8][8] = true
    }

    /** Standard-ish mask scoring. Any mask yields a valid symbol as long as
     *  the format bits match it, so this only picks the tidiest one. */
    private fun penalty(modules: Array<BooleanArray>, size: Int): Int {
        var score = 0
        for (y in 0 until size) {
            var run = 1
            for (x in 1 until size) {
                if (modules[y][x] == modules[y][x - 1]) {
                    run++
                    if (run == 5) score += 3 else if (run > 5) score++
                } else {
                    run = 1
                }
            }
        }
        for (x in 0 until size) {
            var run = 1
            for (y in 1 until size) {
                if (modules[y][x] == modules[y - 1][x]) {
                    run++
                    if (run == 5) score += 3 else if (run > 5) score++
                } else {
                    run = 1
                }
            }
        }
        for (y in 0 until size - 1) for (x in 0 until size - 1) {
            val v = modules[y][x]
            if (v == modules[y][x + 1] && v == modules[y + 1][x] && v == modules[y + 1][x + 1]) score += 3
        }
        var dark = 0
        for (y in 0 until size) for (x in 0 until size) if (modules[y][x]) dark++
        val total = size * size
        score += (Math.abs(dark * 20 - total * 10) / total) * 10
        return score
    }
}
