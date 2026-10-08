// What a finished Hero video needs after generation: a thumbnail to show, a readable title,
// and posting or scheduling through the same sender the step-by-step videos use.

const CLOUDINARY_VIDEO = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/;

/** A still frame from the clip for cards and lists; '' when the link is not a hosted video. */
function thumbnailFor(videoUrl) {
  const m = CLOUDINARY_VIDEO.exec(String(videoUrl || ''));
  if (!m) return '';
  return `${m[1]}so_1,w_480,h_480,c_fill,g_auto,f_jpg/${m[2]}`.replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg');
}

const clean = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A short human title from what the plan saved with the job, never the whole prompt. */
function titleFor(job) {
  const p = (job && job.payload) || {};
  const beat = Array.isArray(p.beatSheet) && p.beatSheet[0] && p.beatSheet[0].beat;
  const line = clean(beat, 70) || clean(String(p.dialogue || '').split(/[\n.]/)[0], 70);
  return line || 'Hero video';
}

/**
 * Post or schedule a finished Hero video. `post` and `publish` are injected so this is tested without a network.
 */
async function shareHeroVideo({ job, user, body, publishVideoDraft, post }) {
  if (!job || job.status !== 'completed' || !(job.result && job.result.videoUrl)) {
    return { status: 400, json: { success: false, message: 'This video is not ready yet.' } };
  }
  const b = body || {};
  const publishNow = b.publishNow === true;
  const sent = await publishVideoDraft({
    post,
    profileKey: (user && user.ayrshare && user.ayrshare.profileKey) || '',
    platforms: Array.isArray(b.platforms) ? b.platforms : [],
    caption: clean(b.caption, 2000),
    hashtags: Array.isArray(b.hashtags) ? b.hashtags.slice(0, 30) : String(b.hashtags || '').split(/\s+/).slice(0, 30),
    videoUrl: job.result.videoUrl,
    scheduledAt: publishNow ? null : b.scheduledAt,
    publishNow
  });
  if (!sent.ok) return { status: sent.code === 'provider' ? 502 : 400, json: { success: false, message: sent.message }, providerError: sent.providerError };
  return {
    status: 200,
    json: { success: true, status: sent.status, message: publishNow ? 'Your video is being posted now.' : 'Your video is scheduled.' },
    record: { status: sent.status, platforms: sent.platforms, at: publishNow ? new Date().toISOString() : new Date(b.scheduledAt).toISOString() }
  };
}

module.exports = { thumbnailFor, titleFor, shareHeroVideo };
