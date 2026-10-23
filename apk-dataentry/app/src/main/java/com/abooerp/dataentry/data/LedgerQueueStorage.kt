package com.abooerp.dataentry.data

import android.content.Context
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.io.File
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Whole-file JSON persistence for the offline ledger-row queue. Volume is
 * small (roughly a couple hundred rows per working day for one device), so
 * rewriting the whole file on every change is simple and safe — no partial
 * writes to reason about, no database migrations to maintain.
 */
class LedgerQueueStorage(context: Context) {
    private val file = File(context.filesDir, "ledger_queue.json")
    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val listType = Types.newParameterizedType(List::class.java, QueuedLedgerRow::class.java)
    private val adapter = moshi.adapter<List<QueuedLedgerRow>>(listType)
    private val mutex = Mutex()

    suspend fun loadAll(): List<QueuedLedgerRow> = mutex.withLock {
        if (!file.exists()) return@withLock emptyList()
        try {
            adapter.fromJson(file.readText()) ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun saveAll(rows: List<QueuedLedgerRow>) = mutex.withLock {
        file.writeText(adapter.toJson(rows))
    }
}
