package com.example.ui.documentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.AgentDocumentationDetail
import com.example.data.AgentDocumentationSummary
import com.example.network.ApiService
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class DocumentationTransitFilter {
    ALL,
    ACTIVE,
    HISTORICAL,
}

sealed class DocumentationListState {
    object Loading : DocumentationListState()
    data class Success(
        val items: List<AgentDocumentationSummary>,
        val dateFrom: String,
        val dateTo: String,
        val transitFilter: DocumentationTransitFilter,
    ) : DocumentationListState()
    data class Error(val message: String) : DocumentationListState()
}

sealed class DocumentationDetailState {
    object Loading : DocumentationDetailState()
    data class Success(val detail: AgentDocumentationDetail) : DocumentationDetailState()
    data class Error(val message: String) : DocumentationDetailState()
}

class DocumentationViewModel(private val apiService: ApiService) : ViewModel() {
    private val damascusZone = ZoneId.of("Asia/Damascus")

    private val _transitFilter = MutableStateFlow(DocumentationTransitFilter.ALL)
    val transitFilter: StateFlow<DocumentationTransitFilter> = _transitFilter.asStateFlow()

    private val _listState = MutableStateFlow<DocumentationListState>(DocumentationListState.Loading)
    val listState: StateFlow<DocumentationListState> = _listState.asStateFlow()

    private val _detailState = MutableStateFlow<DocumentationDetailState?>(null)
    val detailState: StateFlow<DocumentationDetailState?> = _detailState.asStateFlow()

    init {
        loadDocumentation()
    }

    fun setTransitFilter(filter: DocumentationTransitFilter) {
        _transitFilter.value = filter
        reloadWithCurrentData()
    }

    fun loadDocumentation() {
        viewModelScope.launch {
            _listState.value = DocumentationListState.Loading
            val today = LocalDate.now(damascusZone)
            val dateFrom = today.minusDays(30).toString()
            val dateTo = today.toString()
            try {
                val response = apiService.getAgentDocumentation(
                    dateFrom = dateFrom,
                    dateTo = dateTo,
                    limit = 200,
                )
                if (response.success && response.data != null) {
                    val filtered = applyTransitFilter(response.data, _transitFilter.value)
                    _listState.value = DocumentationListState.Success(filtered, dateFrom, dateTo, _transitFilter.value)
                } else {
                    _listState.value = DocumentationListState.Error(response.error ?: "تعذر تحميل التوثيق")
                }
            } catch (e: retrofit2.HttpException) {
                _listState.value = DocumentationListState.Error(
                    if (e.code() == 401) "انتهت الجلسة، يرجى تسجيل الدخول مجدداً" else "استجابة غير متوقعة من الخادم",
                )
            } catch (e: Exception) {
                _listState.value = DocumentationListState.Error(
                    if (e is IOException) "تعذر الاتصال بالخادم" else "تعذر تحميل التوثيق",
                )
            }
        }
    }

    fun loadDetail(id: String) {
        viewModelScope.launch {
            _detailState.value = DocumentationDetailState.Loading
            try {
                val response = apiService.getAgentDocumentationDetail(id)
                if (response.success && response.data != null) {
                    _detailState.value = DocumentationDetailState.Success(response.data)
                } else {
                    _detailState.value = DocumentationDetailState.Error(response.error ?: "تعذر تحميل التفاصيل")
                }
            } catch (e: Exception) {
                _detailState.value = DocumentationDetailState.Error(
                    if (e is IOException) "تعذر الاتصال بالخادم" else "تعذر تحميل التفاصيل",
                )
            }
        }
    }

    fun clearDetail() {
        _detailState.value = null
    }

    private fun reloadWithCurrentData() {
        val current = _listState.value
        if (current is DocumentationListState.Success) {
            viewModelScope.launch {
                try {
                    val response = apiService.getAgentDocumentation(
                        dateFrom = current.dateFrom,
                        dateTo = current.dateTo,
                        limit = 200,
                    )
                    if (response.success && response.data != null) {
                        val filtered = applyTransitFilter(response.data, _transitFilter.value)
                        _listState.value = current.copy(items = filtered, transitFilter = _transitFilter.value)
                    }
                } catch (_: Exception) {
                    // Keep previous list on filter-only refresh failure.
                }
            }
        } else {
            loadDocumentation()
        }
    }

    private fun applyTransitFilter(
        items: List<AgentDocumentationSummary>,
        filter: DocumentationTransitFilter,
    ): List<AgentDocumentationSummary> = when (filter) {
        DocumentationTransitFilter.ALL -> items
        DocumentationTransitFilter.ACTIVE -> items.filter {
            it.transitStatus == "en_route" || it.transitStatus == "dispatched"
        }
        DocumentationTransitFilter.HISTORICAL -> items.filter { it.transitStatus == "historical" }
    }

    class Factory(private val apiService: ApiService) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return DocumentationViewModel(apiService) as T
        }
    }
}
