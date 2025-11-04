const METRIC_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

function coerceNumber(value: number) {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return value;
}

type CounterMetric = {
  name: string;
  help: string;
  value: number;
};

type HistogramMetric = {
  name: string;
  help: string;
  buckets: number[];
  bucketCounts: number[];
  count: number;
  sum: number;
};

const counters: CounterMetric[] = [];
const histograms: HistogramMetric[] = [];

function sanitizeBuckets(bounds: number[]): number[] {
  const unique = Array.from(new Set(bounds.filter((value) => Number.isFinite(value) && value >= 0)));
  unique.sort((a, b) => a - b);
  return unique;
}

function escapeHelp(help: string) {
  return help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatValue(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(9).replace(/0+$/, '').replace(/\.$/, '');
}

class CounterHandle {
  private metric: CounterMetric;

  constructor(metric: CounterMetric) {
    this.metric = metric;
  }

  inc(value = 1) {
    const increment = coerceNumber(value);
    if (increment <= 0) {
      return;
    }
    this.metric.value += increment;
  }
}

class HistogramHandle {
  private metric: HistogramMetric;

  constructor(metric: HistogramMetric) {
    this.metric = metric;
  }

  observe(value: number) {
    const sample = coerceNumber(value);
    if (sample < 0) {
      return;
    }

    const { buckets, bucketCounts } = this.metric;
    for (let index = 0; index < buckets.length; index += 1) {
      const bound = buckets[index];
      if (bound === undefined) {
        continue;
      }
      if (sample <= bound) {
        const current = bucketCounts[index] ?? 0;
        bucketCounts[index] = current + 1;
      }
    }

    const infIndex = bucketCounts.length - 1;
    const currentInf = bucketCounts[infIndex] ?? 0;
    bucketCounts[infIndex] = currentInf + 1;
    this.metric.count += 1;
    this.metric.sum += sample;
  }
}

function registerCounter(name: string, help: string): CounterHandle {
  const metric: CounterMetric = { name, help, value: 0 };
  counters.push(metric);
  return new CounterHandle(metric);
}

function registerHistogram(name: string, help: string, buckets: number[]): HistogramHandle {
  const sanitized = sanitizeBuckets(buckets);
  const metric: HistogramMetric = {
    name,
    help,
    buckets: sanitized,
    bucketCounts: new Array(sanitized.length + 1).fill(0),
    count: 0,
    sum: 0,
  };
  histograms.push(metric);
  return new HistogramHandle(metric);
}

const sessionStartCounter = registerCounter(
  'sessions_started_total',
  'Count of onboarding sessions that have been started.',
);

const turnHandledCounter = registerCounter(
  'session_turns_handled_total',
  'Count of conversation turns (text or voice) that have been persisted.',
);

const slotUpdateCounter = registerCounter(
  'session_slot_updates_total',
  'Count of structured slot updates that have been applied.',
);

const sessionStartHistogram = registerHistogram(
  'session_start_duration_seconds',
  'Session start handler latency in seconds.',
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
);

const turnHandledHistogram = registerHistogram(
  'session_turn_duration_seconds',
  'Latency of persisting session turns in seconds.',
  [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
);

const slotUpdateHistogram = registerHistogram(
  'slot_update_duration_seconds',
  'Latency of applying structured slot updates in seconds.',
  [0.01, 0.05, 0.1, 0.25, 0.5, 1],
);

export function recordSessionStart(durationSeconds: number) {
  sessionStartCounter.inc();
  sessionStartHistogram.observe(durationSeconds);
}

export function recordTurnHandled(turns: number, durationSeconds: number) {
  if (turns > 0) {
    turnHandledCounter.inc(turns);
  }
  turnHandledHistogram.observe(durationSeconds);
}

export function recordSlotUpdates(count: number, durationSeconds: number) {
  if (count > 0) {
    slotUpdateCounter.inc(count);
  }
  if (count > 0) {
    slotUpdateHistogram.observe(durationSeconds);
  }
}

function renderCounters(metric: CounterMetric): string {
  const lines = [`# HELP ${metric.name} ${escapeHelp(metric.help)}`, `# TYPE ${metric.name} counter`, `${metric.name} ${formatValue(metric.value)}`];
  return lines.join('\n');
}

function renderHistogram(metric: HistogramMetric): string {
  const lines: string[] = [
    `# HELP ${metric.name} ${escapeHelp(metric.help)}`,
    `# TYPE ${metric.name} histogram`,
  ];

  for (let index = 0; index < metric.buckets.length; index += 1) {
    const bound = metric.buckets[index] ?? 0;
    const value = metric.bucketCounts[index] ?? 0;
    lines.push(`${metric.name}_bucket{le="${formatValue(bound)}"} ${formatValue(value)}`);
  }

  const infCount = metric.bucketCounts[metric.bucketCounts.length - 1] ?? 0;
  lines.push(`${metric.name}_bucket{le="+Inf"} ${formatValue(infCount)}`);
  lines.push(`${metric.name}_sum ${formatValue(metric.sum)}`);
  lines.push(`${metric.name}_count ${formatValue(metric.count)}`);

  return lines.join('\n');
}

export function getMetricsSnapshot(): string {
  const parts: string[] = [];
  for (const counter of counters) {
    parts.push(renderCounters(counter));
  }
  for (const histogram of histograms) {
    parts.push(renderHistogram(histogram));
  }
  return `${parts.join('\n')}\n`;
}

export const metricsContentType = METRIC_CONTENT_TYPE;
