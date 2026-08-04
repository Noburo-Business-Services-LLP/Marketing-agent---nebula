import { videoGenerationAPI } from '../services/api';

export type DirectorJobPollCallbacks = {
  onProgress?: (job: any) => void;
  signal?: AbortSignal;
};

export async function pollDirectorJob(
  queueJobId: string,
  callbacks: DirectorJobPollCallbacks = {}
): Promise<any> {
  const timeoutMs = 20 * 60 * 1000;
  const startedAt = Date.now();
  let pollDelayMs = 2000;
  let lastUpdatedAt = '';
  let unchangedTicks = 0;
  const { signal, onProgress } = callbacks;

  while (!signal?.aborted) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Background task took too long. Please try again.');
    }

    let job: any;
    try {
      job = await videoGenerationAPI.getJobStatus(queueJobId);
      pollDelayMs = 2000;
    } catch (err: any) {
      const status = Number(err?.status || 0);
      if (status === 429) {
        pollDelayMs = Math.min(15000, Math.round(pollDelayMs * 1.8));
        await new Promise((r) => setTimeout(r, pollDelayMs));
        continue;
      }
      throw err;
    }

    if (signal?.aborted) break;

    onProgress?.(job);

    const status = String(job?.status || '').toLowerCase();
    const updatedAt = String(job?.updatedAt || '');

    if (updatedAt && updatedAt === lastUpdatedAt) {
      unchangedTicks += 1;
    } else {
      unchangedTicks = 0;
      lastUpdatedAt = updatedAt;
    }

    if (status === 'completed') {
      const result = job?.result;
      if (result && result.success === false) {
        throw new Error(result?.message || 'Execution failed');
      }
      return result ?? job;
    }

    if (status === 'cancelled') {
      throw new Error('Job cancelled.');
    }

    if (status === 'failed') {
      throw new Error(job?.error?.message || 'Execution failed');
    }

    if (unchangedTicks >= 5) {
      pollDelayMs = Math.min(15000, Math.round(pollDelayMs * 1.5));
    }

    await new Promise((r) => setTimeout(r, pollDelayMs));
  }

  throw new Error('Polling aborted');
}

export function findActiveQueueJob(draft: any, queueJobs: any[] = []): any | null {
  const active = (queueJobs || []).find((job) => {
    const status = String(job?.status || '').toLowerCase();
    return status === 'queued' || status === 'processing';
  });
  if (active) return active;

  const jobs = draft?.jobs || {};
  const imageJobId = jobs?.images?.queueJobId || draft?.imageJobs?.queueJobId;
  const clipsJobId = jobs?.clips?.queueJobId;
  const mergeJobId = jobs?.merge?.queueJobId;
  const audioJobId = jobs?.audio?.queueJobId;
  const contentJobId = jobs?.content?.queueJobId;

  const sceneClipsJobId = draft?.jobs?.sceneClips
    ? (Object.values(draft.jobs.sceneClips) as any[]).find((entry: any) => entry?.queueJobId && ['queued', 'processing'].includes(String(entry?.status || '').toLowerCase()))?.queueJobId
    : null;
  const pendingId = imageJobId || clipsJobId || mergeJobId || audioJobId || contentJobId || sceneClipsJobId;
  if (!pendingId) return null;

  const match = (queueJobs || []).find((j) => String(j?.jobId) === String(pendingId));
  if (match && ['queued', 'processing'].includes(String(match.status || '').toLowerCase())) {
    return match;
  }

  return {
    jobId: pendingId,
    status: jobs?.images?.status || jobs?.clips?.status || jobs?.merge?.status || jobs?.audio?.status || 'processing'
  };
}
