/**
 * Sends a finished video draft to the chosen networks through the posting provider, now or at a set time.
 * The provider call is injected so this can be tested without the network.
 */
const PLATFORM_TO_PROVIDER = { instagram: 'instagram', facebook: 'facebook', linkedin: 'linkedin', youtube: 'youtube', twitter: 'twitter', x: 'twitter' };

function providerPlatforms(platforms) {
  return Array.from(new Set((Array.isArray(platforms) ? platforms : [])
    .map((p) => PLATFORM_TO_PROVIDER[String(p || '').trim().toLowerCase()])
    .filter(Boolean)));
}

function buildPostText(caption, hashtags) {
  const tags = (Array.isArray(hashtags) ? hashtags : String(hashtags || '').split(/\s+/))
    .map((t) => String(t || '').trim()).filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));
  return [String(caption || '').trim(), tags.join(' ')].filter(Boolean).join('\n\n');
}

async function publishVideoDraft({ post, profileKey, platforms, caption, hashtags, videoUrl, scheduledAt, publishNow }) {
  const targets = providerPlatforms(platforms);
  if (targets.length === 0) return { ok: false, code: 'no_platform', message: 'Choose at least one place to post.' };
  if (!videoUrl) return { ok: false, code: 'no_video', message: 'The video is not ready yet.' };
  if (!profileKey) return { ok: false, code: 'not_connected', message: 'Connect your social accounts first, then publish again.' };
  if (!publishNow && !(scheduledAt && !Number.isNaN(new Date(scheduledAt).getTime()))) {
    return { ok: false, code: 'bad_time', message: 'Choose a valid date and time.' };
  }

  const options = {
    mediaUrls: [videoUrl],
    isVideo: true,
    mediaType: 'video',
    profileKey,
    ...(publishNow ? {} : { scheduleDate: new Date(scheduledAt).toISOString() })
  };
  const result = await post(targets, buildPostText(caption, hashtags), options);
  if (!result || result.success !== true) {
    return { ok: false, code: 'provider', message: 'We could not post this video right now. Please try again in a little while.', providerError: result && result.error };
  }
  return { ok: true, status: publishNow ? 'published' : 'scheduled', platforms: targets, providerId: result.data && (result.data.id || (result.data.posts && result.data.posts[0] && result.data.posts[0].id)) || null };
}

module.exports = { publishVideoDraft, providerPlatforms, buildPostText };
