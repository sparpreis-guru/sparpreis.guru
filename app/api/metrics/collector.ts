import { logDebug } from "@/lib/shared/logger"

const LOG_SCOPE = "metrics.collector"

interface MetricValue {
  value: number
  timestamp: number
  labels?: Record<string, string>
}

interface HistogramBucket {
  le: number // "less than or equal"
  count: number
}

interface Histogram {
  buckets: HistogramBucket[]
  sum: number
  count: number
}

type MetricLabels = Record<string, string>
type BahnApiEndpoint = 'tagesbestpreis' | 'recon' | 'fahrplan'

interface LabeledMetric<T> {
  labels: MetricLabels
  value: T
}

class MetricsCollector {
  private counters = new Map<string, number>()
  private gauges = new Map<string, number>()
  private histograms = new Map<string, Histogram>()
  private labeledCounters = new Map<string, Map<string, LabeledMetric<number>>>()
  private labeledGauges = new Map<string, Map<string, LabeledMetric<number>>>()
  private labeledHistograms = new Map<string, Map<string, LabeledMetric<Histogram>>>()
  
  // Histogram buckets for response times (in milliseconds)
  private readonly responseTimeBuckets = [50, 100, 200, 500, 1000, 2000, 5000, 10000, Infinity]
  private readonly etaErrorBuckets = [1000, 2500, 5000, 10000, 20000, 30000, 60000, 120000, Infinity]
  
  constructor() {
    this.initializeMetrics()
    
    // Cleanup old histogram data every hour
    setInterval(() => this.cleanupOldData(), 60 * 60 * 1000)
  }

  private initializeMetrics() {
    // Initialize counters
    this.counters.set('bahn_api_requests_total', 0)
    this.counters.set('bahn_api_rate_limits_total', 0)
    this.counters.set('user_search_requests_total', 0)
    this.counters.set('user_search_completed_total', 0)
    this.counters.set('user_search_errors_total', 0)
    this.counters.set('days_searched_total', 0)
    this.counters.set('days_cached_total', 0)
    this.counters.set('days_uncached_total', 0)
    this.counters.set('cache_hits_total', 0)
    this.counters.set('cache_misses_total', 0)
    this.counters.set('station_cache_hits_total', 0)
    this.counters.set('station_cache_misses_total', 0)
    this.counters.set('station_search_api_requests_total', 0)
    this.counters.set('station_search_clicks_total', 0)
    this.counters.set('streaming_connections_total', 0)
    this.counters.set('urlaubsfinder_search_requests_total', 0)
    this.counters.set('urlaubsfinder_search_completed_total', 0)
    this.counters.set('urlaubsfinder_search_errors_total', 0)
    this.counters.set('urlaubsfinder_destinations_requested_total', 0)
    this.counters.set('urlaubsfinder_destinations_found_total', 0)
    this.counters.set('urlaubsfinder_destinations_unavailable_total', 0)
    
    // Initialize gauges
    this.gauges.set('bahn_api_current_interval_ms', 1200)
    this.gauges.set('active_search_sessions', 0)
    this.gauges.set('queue_size_total', 0)
    this.gauges.set('active_requests', 0)
    this.gauges.set('cached_stations_count', 0)
    this.gauges.set('cached_connections_count', 0)
    this.gauges.set('memory_usage_mb', 0)
    
    // Initialize histograms
    this.histograms.set('bahn_api_response_time_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })
    
    this.histograms.set('user_search_duration_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })

    this.histograms.set('station_search_api_response_time_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })

    this.histograms.set('urlaubsfinder_search_duration_ms', {
      buckets: this.responseTimeBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })

    this.histograms.set('search_eta_absolute_error_ms', {
      buckets: this.etaErrorBuckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0
    })
  }

  private normalizeLabels(labels?: Record<string, string>): MetricLabels | null {
    if (!labels || Object.keys(labels).length === 0) {
      return null
    }

    return Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, String(value)])
    )
  }

  private labelKey(labels: MetricLabels): string {
    return JSON.stringify(labels)
  }

  private getLabeledMetric<T>(
    store: Map<string, Map<string, LabeledMetric<T>>>,
    name: string,
    labels: MetricLabels,
    createValue: () => T
  ): LabeledMetric<T> {
    const key = this.labelKey(labels)
    let metricSeries = store.get(name)
    if (!metricSeries) {
      metricSeries = new Map()
      store.set(name, metricSeries)
    }

    let metric = metricSeries.get(key)
    if (!metric) {
      metric = { labels, value: createValue() }
      metricSeries.set(key, metric)
    }

    return metric
  }

  private createHistogram(name?: string): Histogram {
    const buckets = name
      ? this.histograms.get(name)?.buckets.map((bucket) => bucket.le) || this.responseTimeBuckets
      : this.responseTimeBuckets
    return {
      buckets: buckets.map(le => ({ le, count: 0 })),
      sum: 0,
      count: 0,
    }
  }

  private observeHistogramValue(histogram: Histogram, value: number) {
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++
      }
    }

    histogram.sum += value
    histogram.count++
  }

  // Counter methods
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>) {
    const normalizedLabels = this.normalizeLabels(labels)
    if (normalizedLabels) {
      const metric = this.getLabeledMetric(this.labeledCounters, name, normalizedLabels, () => 0)
      metric.value += value
      return
    }

    const current = this.counters.get(name) || 0
    this.counters.set(name, current + value)
  }

  // Gauge methods
  setGauge(name: string, value: number, labels?: Record<string, string>) {
    const normalizedLabels = this.normalizeLabels(labels)
    if (normalizedLabels) {
      const metric = this.getLabeledMetric(this.labeledGauges, name, normalizedLabels, () => 0)
      metric.value = value
      return
    }

    this.gauges.set(name, value)
  }

  incrementGauge(name: string, value: number = 1) {
    const current = this.gauges.get(name) || 0
    this.gauges.set(name, current + value)
  }

  decrementGauge(name: string, value: number = 1) {
    const current = this.gauges.get(name) || 0
    this.gauges.set(name, Math.max(0, current - value))
  }

  // Histogram methods
  observeHistogram(name: string, value: number, labels?: Record<string, string>) {
    const normalizedLabels = this.normalizeLabels(labels)
    if (normalizedLabels) {
      const metric = this.getLabeledMetric(this.labeledHistograms, name, normalizedLabels, () => this.createHistogram(name))
      this.observeHistogramValue(metric.value, value)
      return
    }

    const histogram = this.histograms.get(name)
    if (!histogram) return

    this.observeHistogramValue(histogram, value)
  }

  // Specific business metric methods
  recordBahnApiRequest(responseTimeMs: number, statusCode: number | 'network_error', endpoint: BahnApiEndpoint = 'tagesbestpreis') {
    this.incrementCounter('bahn_api_requests_total')
    this.incrementCounter('bahn_api_requests_by_status_total', 1, { status: String(statusCode) })
    this.incrementCounter('bahn_api_requests_by_endpoint_total', 1, { endpoint, status: String(statusCode) })
    this.observeHistogram('bahn_api_response_time_ms', responseTimeMs)
    this.observeHistogram('bahn_api_response_time_by_endpoint_ms', responseTimeMs, { endpoint })
    
    if (statusCode === 429) {
      this.incrementCounter('bahn_api_rate_limits_total')
      this.incrementCounter('bahn_api_rate_limits_by_endpoint_total', 1, { endpoint })
    }
    if (statusCode === 'network_error') {
      this.incrementCounter('bahn_api_network_errors_total', 1, { endpoint })
    }
  }

  /** Measure each executed HTTP attempt, excluding queue time and cache probes. */
  async measureBahnApiRequest<T extends { status: number }>(endpoint: BahnApiEndpoint, request: () => Promise<T>): Promise<T> {
    const startedAt = Date.now()
    let response: T
    try {
      response = await request()
    } catch (error) {
      this.recordBahnApiRequest(Date.now() - startedAt, 'network_error', endpoint)
      throw error
    }
    this.recordBahnApiRequest(Date.now() - startedAt, response.status, endpoint)
    return response
  }

  recordFlexpreisCacheLookup(kind: 'offer' | 'timetable', hit: boolean) {
    if (hit) this.recordCacheHit('connection')
    else this.recordCacheMiss('connection')
    this.incrementCounter(hit ? 'flexpreis_cache_hits_total' : 'flexpreis_cache_misses_total', 1, { kind })
  }

  recordUserSearch(daysSearched: number, cachedDays: number = 0, uncachedDays: number = 0) {
    this.incrementCounter('user_search_requests_total')
    this.incrementCounter('days_searched_total', daysSearched)
    this.incrementCounter('days_cached_total', cachedDays)
    this.incrementCounter('days_uncached_total', uncachedDays)
  }

  recordUserSearchCompletion() {
    this.incrementCounter('user_search_completed_total')
  }

  recordUserSearchError() {
    this.incrementCounter('user_search_errors_total')
  }

  recordCacheHit(type: 'connection' | 'station' = 'connection') {
    if (type === 'station') {
      this.incrementCounter('station_cache_hits_total')
    } else {
      this.incrementCounter('cache_hits_total')
    }
  }

  recordCacheMiss(type: 'connection' | 'station' = 'connection') {
    if (type === 'station') {
      this.incrementCounter('station_cache_misses_total')
    } else {
      this.incrementCounter('cache_misses_total')
    }
  }

  recordCacheStale(type: 'connection' | 'station' = 'connection') {
    this.incrementCounter('cache_stale_total', 1, { type })
  }

  recordStationSearchApiRequest(responseTimeMs: number, statusCode: number) {
    this.incrementCounter('station_search_api_requests_total')
    this.incrementCounter('station_search_api_requests_by_status_total', 1, { status: String(statusCode) })
    this.observeHistogram('station_search_api_response_time_ms', responseTimeMs)
  }

  recordStationSearchClick() {
    this.incrementCounter('station_search_clicks_total')
  }

  updateRateLimitInterval(intervalMs: number) {
    this.setGauge('bahn_api_current_interval_ms', intervalMs)
  }

  updateQueueMetrics(queueSize: number, activeRequests: number, activeSessions: number) {
    this.setGauge('queue_size_total', queueSize)
    this.setGauge('active_requests', activeRequests)
    this.setGauge('active_search_sessions', activeSessions)
  }

  updateCacheMetrics(stationCount: number, connectionCount: number) {
    this.setGauge('cached_stations_count', stationCount)
    this.setGauge('cached_connections_count', connectionCount)
  }

  recordSessionCancellation(reason: string) {
    this.incrementCounter('session_cancellations_total', 1, { reason })
  }

  recordStreamingConnection() {
    this.incrementCounter('streaming_connections_total')
  }

  recordSearchDuration(durationMs: number) {
    this.observeHistogram('user_search_duration_ms', durationMs)
  }

  recordSearchEtaAccuracy(searchType: string, estimatedRemainingMs: number, actualRemainingMs: number) {
    const signedErrorMs = estimatedRemainingMs - actualRemainingMs
    const labels = { search_type: searchType }

    this.observeHistogram('search_eta_absolute_error_ms', Math.abs(signedErrorMs), labels)
    this.incrementCounter('search_eta_samples_total', 1, labels)

    if (signedErrorMs >= 0) {
      this.incrementCounter('search_eta_overestimation_ms_total', signedErrorMs, labels)
    } else {
      this.incrementCounter('search_eta_underestimation_ms_total', Math.abs(signedErrorMs), labels)
    }
  }

  recordUrlaubsfinderSearch(destinationCount: number) {
    this.incrementCounter('urlaubsfinder_search_requests_total')
    this.incrementCounter('urlaubsfinder_destinations_requested_total', destinationCount)
  }

  recordUrlaubsfinderCompletion(durationMs: number, foundDestinations: number, unavailableDestinations: number) {
    this.incrementCounter('urlaubsfinder_search_completed_total')
    this.incrementCounter('urlaubsfinder_destinations_found_total', foundDestinations)
    this.incrementCounter('urlaubsfinder_destinations_unavailable_total', unavailableDestinations)
    this.observeHistogram('urlaubsfinder_search_duration_ms', durationMs)
  }

  recordUrlaubsfinderError() {
    this.incrementCounter('urlaubsfinder_search_errors_total')
  }

  // Memory usage tracking
  updateMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      const usageMB = Math.round(usage.heapUsed / 1024 / 1024)
      this.setGauge('memory_usage_mb', usageMB)
    }
  }

  private cleanupOldData() {
    logDebug(LOG_SCOPE, "Metrics cleanup tick")
    // Histogramme haben keine automatische Bereinigung in diesem einfachen System
    // In einer produktiven Umgebung würde man hier ältere Daten archivieren
  }

  // Export metrics in Prometheus format
  exportPrometheusMetrics(): string {
    let output = ''
    
    // Export counters
    const counterNames = new Set([...this.counters.keys(), ...this.labeledCounters.keys()])
    for (const name of counterNames) {
      output += `# TYPE ${name} counter\n`
      const value = this.counters.get(name)
      if (value !== undefined) {
        output += `${name} ${value}\n`
      }
      for (const metric of this.labeledCounters.get(name)?.values() ?? []) {
        output += `${name}{${this.formatLabels(metric.labels)}} ${metric.value}\n`
      }
      output += '\n'
    }
    
    // Export gauges
    const gaugeNames = new Set([...this.gauges.keys(), ...this.labeledGauges.keys()])
    for (const name of gaugeNames) {
      output += `# TYPE ${name} gauge\n`
      const value = this.gauges.get(name)
      if (value !== undefined) {
        output += `${name} ${value}\n`
      }
      for (const metric of this.labeledGauges.get(name)?.values() ?? []) {
        output += `${name}{${this.formatLabels(metric.labels)}} ${metric.value}\n`
      }
      output += '\n'
    }
    
    // Export histograms
    const histogramNames = new Set([...this.histograms.keys(), ...this.labeledHistograms.keys()])
    for (const name of histogramNames) {
      output += `# TYPE ${name} histogram\n`

      const histogram = this.histograms.get(name)
      if (histogram) {
        for (const bucket of histogram.buckets) {
          output += `${name}_bucket{le="${bucket.le === Infinity ? '+Inf' : bucket.le}"} ${bucket.count}\n`
        }

        output += `${name}_sum ${histogram.sum}\n`
        output += `${name}_count ${histogram.count}\n`
      }

      for (const metric of this.labeledHistograms.get(name)?.values() ?? []) {
        const labelStr = this.formatLabels(metric.labels)
        for (const bucket of metric.value.buckets) {
          output += `${name}_bucket{${labelStr},le="${bucket.le === Infinity ? '+Inf' : bucket.le}"} ${bucket.count}\n`
        }
        output += `${name}_sum{${labelStr}} ${metric.value.sum}\n`
        output += `${name}_count{${labelStr}} ${metric.value.count}\n\n`
      }
      output += '\n'
    }
    
    // Add timestamp
    output += `# Generated at ${new Date().toISOString()}\n`
    
    return output
  }

  // Get current metrics as JSON (for debugging)
  getMetricsJSON() {
    this.updateMemoryUsage()
    
    return {
      counters: Object.fromEntries(this.counters),
      labeledCounters: this.mapLabeledMetrics(this.labeledCounters),
      gauges: Object.fromEntries(this.gauges),
      labeledGauges: this.mapLabeledMetrics(this.labeledGauges),
      histograms: Object.fromEntries(this.histograms),
      labeledHistograms: this.mapLabeledMetrics(this.labeledHistograms),
      timestamp: new Date().toISOString()
    }
  }

  private formatLabels(labels: MetricLabels): string {
    return Object.entries(labels)
      .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',')
  }

  private mapLabeledMetrics<T>(store: Map<string, Map<string, LabeledMetric<T>>>) {
    return Object.fromEntries(
      Array.from(store.entries()).map(([name, series]) => [
        name,
        Array.from(series.values()).map(metric => ({
          labels: metric.labels,
          value: metric.value,
        })),
      ])
    )
  }
}

// Global metrics collector instance
export const metricsCollector = new MetricsCollector()

// Update memory usage every 30 seconds
setInterval(() => {
  metricsCollector.updateMemoryUsage()
}, 30 * 1000)
