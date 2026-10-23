package com.example.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "offline_pings")
data class OfflinePingEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
    val recordedAt: String,
    val tripId: String,
    val timestamp: Long = System.currentTimeMillis()
)
