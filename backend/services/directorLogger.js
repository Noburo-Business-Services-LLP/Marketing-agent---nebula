function baseContext(ctx = {}) {
  return {
    jobId: ctx.jobId || ctx.draftId || null,
    draftId: ctx.draftId || ctx.jobId || null,
    userId: ctx.userId ? String(ctx.userId) : null,
    organizationId: ctx.organizationId ? String(ctx.organizationId) : null,
    characterId: ctx.characterId || null,
    queueJobId: ctx.queueJobId || null,
    timestamp: new Date().toISOString()
  };
}

function logDirector(event, message, ctx = {}, extra = {}) {
  const payload = {
    event,
    message,
    ...baseContext(ctx),
    ...extra
  };
  console.log(JSON.stringify(payload));
  return payload;
}

module.exports = {
  logDirector,
  logJobStarted: (ctx, extra) => logDirector('job_started', 'Job started', ctx, extra),
  logJobFinished: (ctx, extra) => logDirector('job_finished', 'Job finished', ctx, extra),
  logJobFailed: (ctx, extra) => logDirector('job_failed', 'Job failed', ctx, extra),
  logAutosave: (ctx, extra) => logDirector('autosave', 'Draft autosaved', ctx, extra),
  logMongoSave: (ctx, extra) => logDirector('mongo_save', 'Draft saved to MongoDB', ctx, extra),
  logIdentityValidation: (ctx, extra) => logDirector('identity_validation', 'Identity validated', ctx, extra),
  logQueueRecovery: (ctx, extra) => logDirector('queue_recovery', 'Queue recovery', ctx, extra),
  logPublish: (ctx, extra) => logDirector('publish', 'Publish action', ctx, extra)
};
