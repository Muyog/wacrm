"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
} from 'lucide-react'

import {
  loadActivity,
  loadChannelsDonut,
  loadConversationsSeries,
  loadMessagesDonut,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
  loadTopics,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ChannelsDonutData,
  ConversationsSeriesPoint,
  MessagesDonutData,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
  TopicsData,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { DonutsCard } from '@/components/dashboard/donuts-card'
import { TopicsCloud } from '@/components/dashboard/topics-cloud'

import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const { defaultCurrency } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [topics, setTopics] = useState<TopicsData | null>(null)
  const [topicsLoading, setTopicsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  // Donut pair follows the same range filter as the series chart,
  // with its own per-range cache (same pattern).
  const [channelsByRange, setChannelsByRange] = useState<Record<RangeDays, ChannelsDonutData | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [messagesByRange, setMessagesByRange] = useState<Record<RangeDays, MessagesDonutData | null>>({
    7: null,
    30: null,
    90: null,
  })
  const channels = channelsByRange[range]
  const messagesBySender = messagesByRange[range]
  const donutsLoading = channelsByRange[range] === null || messagesByRange[range] === null

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))

    void loadChannelsDonut(db, 30)
      .then((c) => setChannelsByRange((prev) => ({ ...prev, 30: c })))
      .catch((err) => console.error('[dashboard] channels donut failed:', err))

    void loadMessagesDonut(db, 30)
      .then((m) => setMessagesByRange((prev) => ({ ...prev, 30: m })))
      .catch((err) => console.error('[dashboard] messages donut failed:', err))

    void loadTopics(db)
      .then((t) => setTopics(t))
      .catch((err) => console.error('[dashboard] topics failed:', err))
      .finally(() => setTopicsLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      const db = createClient()
      if (series[r] === null) {
        setSeriesLoading(true)
        loadConversationsSeries(db, r)
          .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
          .catch((err) => console.error('[dashboard] series failed:', err))
          .finally(() => setSeriesLoading(false))
      }
      // Donuts follow the same range — fetch when not cached.
      if (channelsByRange[r] === null) {
        loadChannelsDonut(db, r)
          .then((c) => setChannelsByRange((prev) => ({ ...prev, [r]: c })))
          .catch((err) => console.error('[dashboard] channels donut failed:', err))
      }
      if (messagesByRange[r] === null) {
        loadMessagesDonut(db, r)
          .then((m) => setMessagesByRange((prev) => ({ ...prev, [r]: m })))
          .catch((err) => console.error('[dashboard] messages donut failed:', err))
      }
    },
    [series, channelsByRange, messagesByRange],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(
                  metrics.activeConversations.previous, 
                  t('newTodayVsYesterday'), 
                  t('noChange', { suffix: t('newTodayVsYesterday') })
                ),
              }}
            />
            <MetricCard
              title={t('newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
            <MetricCard
              title={t('openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={t('openDeals', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('vsYesterday'),
                  t('noChange', { suffix: t('vsYesterday') })
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row — conversations chart + compact donut pair */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          {/* Combined card: channels + messages-by-sender in one block,
              filtered by the same 7/30/90 range as the line chart. */}
          <div className="h-full">
            {donutsLoading ? (
              <section className="flex h-full flex-col rounded-xl border border-border bg-card">
                <header className="border-b border-border px-5 py-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                </header>
                <div className="flex flex-1 items-center justify-center gap-8 p-6">
                  <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
                  <div className="h-24 w-24 animate-pulse rounded-full bg-muted" />
                </div>
              </section>
            ) : (
              <DonutsCard channels={channels} messages={messagesBySender} />
            )}
          </div>
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />

      {/* Pipeline (moved here) + topics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-full lg:col-span-2"><PipelineDonut data={pipeline} loading={pipelineLoading} currency={defaultCurrency} /></div>
        <div className="h-full"><TopicsCloud data={topics} /></div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
