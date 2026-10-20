'use strict';
/**
 * Optional CloudWatch emitter for the generation queue (E9 stage A, docs/superpowers/ops/generation-parallelism.md).
 * OFF unless QUEUE_METRICS_CLOUDWATCH=on. Every QUEUE_METRICS_INTERVAL_MS (default 30 s, 10 s..300 s) a consumer process
 * pushes namespace `Nebulaa/Queue` (QUEUE_METRICS_NAMESPACE): QueueDepth, OldestQueuedAge (seconds), Running,
 * SlotsInUse and SlotsTotal (this worker), dimension Queue=video|image|omni. Use the Maximum statistic for depth and age
 * (every worker reports the same database-wide numbers).
 *
 * The AWS client is `@aws-sdk/client-cloudwatch`, loaded only when the switch is on; it is NOT installed today, so
 * turning the switch on without installing it logs one warning and sends nothing. Tests inject `send` and never touch AWS.
 */
const DEFAULT_INTERVAL_MS = 30000;

function enabled(env = process.env) {
  return String(env.QUEUE_METRICS_CLOUDWATCH || '').trim().toLowerCase() === 'on';
}

/** The CloudWatch metric data for one snapshot ({ video, image } from the two queues' metrics()). */
function toMetricData({ video, image, studio, photoshoot } = {}) {
  const out = [];
  const add = (queue, name, value, unit) => {
    if (!Number.isFinite(Number(value))) return;
    out.push({ MetricName: name, Dimensions: [{ Name: 'Queue', Value: queue }], Unit: unit, Value: Number(value) });
  };
  if (video) {
    add('video', 'QueueDepth', video.queueDepth, 'Count');
    add('video', 'OldestQueuedAge', video.oldestQueuedAgeSeconds, 'Seconds');
    add('video', 'Running', video.running, 'Count');
    const tw = video.thisWorker || {};
    const inUse = (Number(tw.slotsInUse?.image) || 0) + (Number(tw.slotsInUse?.video) || 0);
    const total = (Number(tw.slots?.image) || 0) + (Number(tw.slots?.video) || 0);
    add('video', 'SlotsInUse', inUse, 'Count');
    add('video', 'SlotsTotal', total, 'Count');
  }
  if (image) {
    add('image', 'QueueDepth', image.queueDepth, 'Count');
    add('image', 'OldestQueuedAge', image.oldestQueuedAgeSeconds, 'Seconds');
    add('image', 'Running', image.running, 'Count');
    add('image', 'SlotsInUse', image.thisWorker?.slotsInUse, 'Count');
    add('image', 'SlotsTotal', image.thisWorker?.slots, 'Count');
  }
  if (studio) {
    // Videos (Gemini Omni) consumer, E9 stage B1.
    add('omni', 'QueueDepth', studio.queueDepth, 'Count');
    add('omni', 'OldestQueuedAge', studio.oldestQueuedAgeSeconds, 'Seconds');
    add('omni', 'Running', studio.running, 'Count');
    add('omni', 'SlotsInUse', studio.thisWorker?.slotsInUse?.omni, 'Count');
    add('omni', 'SlotsTotal', studio.thisWorker?.slots?.omni, 'Count');
  }
  if (photoshoot) {
    // Photoshoot consumer, E9 stage B2.
    add('photoshoot', 'QueueDepth', photoshoot.queueDepth, 'Count');
    add('photoshoot', 'OldestQueuedAge', photoshoot.oldestQueuedAgeSeconds, 'Seconds');
    add('photoshoot', 'Running', photoshoot.running, 'Count');
    add('photoshoot', 'SlotsInUse', photoshoot.thisWorker?.slotsInUse?.photoshoot, 'Count');
    add('photoshoot', 'SlotsTotal', photoshoot.thisWorker?.slots?.photoshoot, 'Count');
  }
  return out;
}

function defaultSender(log) {
  let client = null;
  let Put = null;
  let warned = false;
  return async ({ namespace, data }) => {
    if (!client) {
      try {
        const cw = require('@aws-sdk/client-cloudwatch'); // optional; not a dependency today
        client = new cw.CloudWatchClient({});
        Put = cw.PutMetricDataCommand;
      } catch (_) {
        if (!warned) { warned = true; log.warn('[queue metrics] QUEUE_METRICS_CLOUDWATCH=on but @aws-sdk/client-cloudwatch is not installed: nothing is sent'); }
        return false;
      }
    }
    await client.send(new Put({ Namespace: namespace, MetricData: data }));
    return true;
  };
}

/**
 * Starts the emitter when the switch is on. `collect` returns { video, image }; `send` defaults to the CloudWatch client.
 * Returns null when off, otherwise { stop, tick }.
 */
function startQueueMetricsEmitter({ env = process.env, collect, send, log = console, timers = { setInterval, clearInterval } } = {}) {
  if (!enabled(env)) return null;
  const n = Number.parseInt(String(env.QUEUE_METRICS_INTERVAL_MS || ''), 10);
  const every = Number.isFinite(n) ? Math.max(10000, Math.min(300000, n)) : DEFAULT_INTERVAL_MS;
  const namespace = String(env.QUEUE_METRICS_NAMESPACE || 'Nebulaa/Queue').trim() || 'Nebulaa/Queue';
  const sender = send || defaultSender(log);
  const collector = collect || (async () => ({
    video: await require('./videoGenerationQueue').videoGenerationQueue.metrics(),
    image: await require('./imageJobQueue').imageJobQueue().metrics(),
    studio: await require('./studioVideoConsumer').studioVideoConsumer.metrics(),
    photoshoot: await require('./photoshootConsumer').photoshootConsumer.metrics()
  }));
  let busy = false;
  const tick = async () => {
    if (busy) return false;
    busy = true;
    try {
      const data = toMetricData(await collector());
      if (!data.length) return false;
      return Boolean(await sender({ namespace, data }));
    } catch (e) {
      log.warn('[queue metrics] could not send:', e && e.message);
      return false;
    } finally { busy = false; }
  };
  const timer = timers.setInterval(() => { tick(); }, every);
  if (timer && timer.unref) timer.unref();
  log.log(`[queue metrics] CloudWatch emitter on (${namespace}, every ${Math.round(every / 1000)} s)`);
  return { stop: () => timers.clearInterval(timer), tick, every, namespace };
}

module.exports = { startQueueMetricsEmitter, toMetricData, enabled };
