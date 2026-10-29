package com.abooerp.dataentry.data

import android.content.Context
import com.abooerp.dataentry.network.ApiService
import java.io.File
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A local pool of company-wide-unique receipt numbers.
 *
 * The number has to be on the printed label the instant the row is saved —
 * the customer is standing there — so it cannot be allocated by the server
 * at save time, and the app must keep working with no signal at all. So
 * the tablet reserves a block of numbers from the shared sequence whenever
 * it has a connection and spends them offline, topping up well before the
 * block runs out.
 *
 * Numbers are never reused: one is removed from the pool the moment it is
 * handed out, whether or not the row later syncs. Burning a few numbers on
 * a failed save is harmless; handing the same number to two shipments
 * would make the QR codes ambiguous, which is the thing this exists to
 * prevent.
 */
class ReceiptNumberStore(context: Context, private val apiService: ApiService) {
    private val file = File(context.filesDir, "receipt_numbers.json")
    private val mutex = Mutex()

    /** Reserve this many at a time, and top up once fewer than [LOW_WATER]
     *  remain — a day's work is a few hundred rows, so this keeps a
     *  comfortable offline buffer without hoarding the sequence. */
    private val blockSize = 100
    private val lowWater = 25

    private fun read(): MutableList<Long> =
        if (!file.exists()) {
            mutableListOf()
        } else {
            try {
                file.readText().split(',').mapNotNull { it.trim().toLongOrNull() }.toMutableList()
            } catch (_: Exception) {
                mutableListOf()
            }
        }

    private fun write(numbers: List<Long>) {
        try {
            file.writeText(numbers.joinToString(","))
        } catch (_: Exception) {
            // A failed write only costs the buffer; the next online top-up
            // refills it. Never let it break a save in progress.
        }
    }

    suspend fun remaining(): Int = mutex.withLock { read().size }

    /** The number the next saved row will carry, without consuming it —
     *  for showing in the entry form before the employee hits save. */
    suspend fun peek(): Long? = mutex.withLock { read().firstOrNull() }

    /** Takes the next number, or null when the pool is empty and offline. */
    suspend fun take(): Long? {
        mutex.withLock {
            val pool = read()
            if (pool.isNotEmpty()) {
                val next = pool.removeAt(0)
                write(pool)
                return next
            }
        }
        // Empty: this is the one case worth a blocking network call, since
        // without a number there is nothing to print.
        refill()
        mutex.withLock {
            val pool = read()
            if (pool.isEmpty()) return null
            val next = pool.removeAt(0)
            write(pool)
            return next
        }
    }

    /** Tops up the pool when it is running low. Silent on failure — the
     *  app keeps spending what it already has. */
    suspend fun refillIfLow() {
        val count = remaining()
        if (count <= lowWater) refill()
    }

    private suspend fun refill() {
        try {
            val response = apiService.reserveReceiptNumbers(ReserveReceiptNumbersRequest(count = blockSize))
            val fetched = response.data?.numbers ?: return
            if (fetched.isEmpty()) return
            mutex.withLock {
                val pool = read()
                pool.addAll(fetched)
                write(pool.sorted())
            }
        } catch (_: Exception) {
            // Offline, or the server is unreachable — expected in the yard.
        }
    }
}
