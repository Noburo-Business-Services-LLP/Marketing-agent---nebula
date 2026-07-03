const fs = require('fs');
const path = 'backend/routes/videoGeneration.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add generate_content queue handler at the top (near other handlers)
const generateContentHandler = `
videoGenerationQueue.registerHandler('generate_content', async (payload, { update, log }) => {
  const { jobId, userId, selectedPlatforms, baseUrl } = payload;
  await update({ progress: 10, currentStep: 'generate_content' });
  await log(\`Generating content (thumbnail, caption, hashtags) for draft \${jobId}\`);

  const draft = await loadDraftForUser(jobId, userId);
  const platforms = normalizePlatforms(selectedPlatforms?.length ? selectedPlatforms : (draft?.platform?.selectedPlatforms || []));
  
  const thumbnailUrl = await generateThumbnailFromDraft({ draft, baseUrl });
  const socialContent = await generateCaptionAndHashtags({ draft, selectedPlatforms: platforms });

  const updated = await updateDraft(jobId, userId, (current) => ({
    ...current,
    currentStep: Math.max(Number(current.currentStep || 1), 8),
    thumbnailUrl,
    content: {
      thumbnailUrl,
      caption: socialContent.caption,
      hashtags: socialContent.hashtags,
      generatedAt: new Date().toISOString()
    },
    thumbnails: thumbnailUrl ? { url: thumbnailUrl, generatedAt: new Date().toISOString() } : current.thumbnails,
    jobs: {
      ...(current.jobs || {}),
      content: current.jobs?.content
        ? { ...current.jobs.content, status: 'completed', completedAt: new Date().toISOString() }
        : null
    }
  }));

  try {
    const VideoDraft = require('../models/VideoDraft');
    const draftDoc = await VideoDraft.findOne({ jobId });
    if (draftDoc) {
      draftDoc.thumbnailUrl = thumbnailUrl;
      await draftDoc.save();
    }
  } catch (saveErr) {}

  await learnVideoStep({
    userId,
    jobId,
    action: 'video_content',
    prompt: draft?.prompt?.promptText || '',
    userInput: draft.input || {},
    captions: [socialContent.caption],
    hashtags: socialContent.hashtags,
    thumbnails: [thumbnailUrl].filter(Boolean),
    generatedVideos: [draft?.merge?.finalOutputUrl || draft?.merge?.finalVideoUrl].filter(Boolean),
    product: draft?.input?.product || null,
    aiSettings: { selectedPlatforms: platforms }
  });

  await update({ progress: 100, currentStep: 'completed' });
  return { success: true, jobId, content: updated.content, draft: updated };
});
`;

if (!content.includes("registerHandler('generate_content'")) {
  content = content.replace(
    /videoGenerationQueue\.registerHandler\('merge_video', async \(payload, \{ update, log \}\) => \{/g,
    generateContentHandler + "\nvideoGenerationQueue.registerHandler('merge_video', async (payload, { update, log }) => {"
  );
}

// 2. Add isAsync support inside router.post('/generateContent')
const generateContentRouteStart = `router.post('/generateContent', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, selectedPlatforms = [], async: isAsync } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    
    if (isAsync) {
      const queued = await videoGenerationQueue.enqueue({
        userId,
        jobType: 'generate_content',
        payload: { jobId, userId, selectedPlatforms, baseUrl: reqBaseUrl(req) }
      });
      await updateDraft(jobId, userId, (current) => ({
        ...current,
        jobs: {
          ...(current.jobs || {}),
          content: { queueJobId: queued.jobId, status: 'processing', queuedAt: new Date().toISOString() }
        }
      }));
      return res.status(202).json({ success: true, queueJobId: queued.jobId, message: 'Content generation started in background' });
    }

    const draft = await loadDraftForUser(jobId, userId);`;

content = content.replace(
  `router.post('/generateContent', protect, checkTrial, videoAiWriteLimiter, async (req, res) => {
  try {
    const { jobId, selectedPlatforms = [] } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required' });
    }

    const userId = toUserId(req.user);
    const draft = await loadDraftForUser(jobId, userId);`,
  generateContentRouteStart
);

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated generate_content queue handler!');
