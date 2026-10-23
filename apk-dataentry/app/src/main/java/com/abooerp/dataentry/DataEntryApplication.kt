package com.abooerp.dataentry

import android.app.Application
import com.abooerp.dataentry.di.AppContainer

class DataEntryApplication : Application() {
    lateinit var container: AppContainer

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
