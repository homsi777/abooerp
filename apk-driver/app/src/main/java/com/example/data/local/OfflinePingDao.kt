package com.example.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface OfflinePingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPing(ping: OfflinePingEntity): Long

    @Query("SELECT * FROM offline_pings ORDER BY timestamp ASC")
    suspend fun getAllPending(): List<OfflinePingEntity>

    @Query("SELECT COUNT(*) FROM offline_pings")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM offline_pings")
    suspend fun getPendingCount(): Int

    @Delete
    suspend fun deletePings(pings: List<OfflinePingEntity>)

    @Query("DELETE FROM offline_pings WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM offline_pings")
    suspend fun clearAll()
}
