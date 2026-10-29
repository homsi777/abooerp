package com.abooerp.dataentry.di

import android.content.Context
import com.abooerp.dataentry.data.AuthStorage
import com.abooerp.dataentry.data.LedgerQueueStorage
import com.abooerp.dataentry.data.ReceiptNumberStore
import com.abooerp.dataentry.network.ApiService
import com.abooerp.dataentry.network.NetworkModule
import com.abooerp.dataentry.printer.BluetoothPrinterManager
import com.abooerp.dataentry.printer.TsplLabelPrinter

class AppContainer(context: Context) {
    val authStorage: AuthStorage by lazy { AuthStorage(context) }
    val apiService: ApiService by lazy { NetworkModule.provideApiService(context) }
    val ledgerQueueStorage: LedgerQueueStorage by lazy { LedgerQueueStorage(context) }
    val printerManager: BluetoothPrinterManager by lazy { BluetoothPrinterManager(context) }
    val labelPrinter: TsplLabelPrinter by lazy { TsplLabelPrinter() }
    val receiptNumberStore: ReceiptNumberStore by lazy { ReceiptNumberStore(context, apiService) }
}
