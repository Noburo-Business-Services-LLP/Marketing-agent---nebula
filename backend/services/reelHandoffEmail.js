// Manual video handoff.
//
// The reel wizard stops after Scene Images: clip generation, audio and merge
// are done by the Nebulaa team off-platform. This packages everything the
// user produced in steps 1-5 — who they are, the brief, character/style,
// environment, script and the rendered scene images — and mails it over.

const fs = require('fs');
const path = require('path');
const { createTransporter } = require('./supportEmail');

const HANDOFF_RECIPIENT = String(process.env.REEL_HANDOFF_EMAIL || 'support@nebulaa.ai').trim();
// Scene images are ~1-3MB each; most SMTP hosts reject much beyond 25MB total.
const MAX_IMAGE_ATTACHMENTS = 12;

const STORAGE_ROOT = path.resolve(__dirname, '..', 'storage', 'ai-videos');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Scene images live on local disk behind /generated-media/. Attaching the file
// directly avoids the server round-tripping its own public URL (which fails
// whenever egress to the app's own hostname is blocked).
function localPathForGeneratedMedia(url) {
  try {
    const pathname = new URL(String(url || '')).pathname;
    const prefix = '/generated-media/';
    if (!pathname.startsWith(prefix)) return null;

    const relative = decodeURIComponent(pathname.slice(prefix.length));
    const segments = relative.split('/').filter((part) => part && part !== '.' && part !== '..');
    if (!segments.length) return null;

    const absolute = path.resolve(STORAGE_ROOT, ...segments);
    if (!absolute.startsWith(STORAGE_ROOT)) return null;
    return fs.existsSync(absolute) ? absolute : null;
  } catch (_) {
    return null;
  }
}

function collectScenes(draft) {
  const raw = Array.isArray(draft?.scenes)
    ? draft.scenes
    : (draft?.scenes?.sceneData || draft?.images?.scenes || []);
  return (Array.isArray(raw) ? raw : []).map((scene, index) => ({
    index: index + 1,
    title: String(scene?.title || `Scene ${index + 1}`).trim(),
    durationSeconds: Number(scene?.durationSeconds || 0) || null,
    scriptLine: String(scene?.scriptLine || scene?.voiceLine || '').trim(),
    visualDescription: String(scene?.visualDescription || '').trim(),
    imagePrompt: String(scene?.imagePrompt || '').trim(),
    cameraAngle: String(scene?.cameraAngle || '').trim(),
    cameraMovement: String(scene?.cameraMovement || '').trim(),
    imageUrl: String(scene?.imageUrl || '').trim()
  }));
}

function section(title, rows) {
  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(value)}</td>
      </tr>`)
    .join('');
  if (!body) return '';
  return `
    <h3 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;">${escapeHtml(title)}</h3>
    <table style="border-collapse:collapse;width:100%;">${body}</table>`;
}

async function sendReelHandoffEmail({ draft, user, baseUrl = '' }) {
  const transporter = createTransporter();
  const smtpEmail = process.env.SMTP_EMAIL;

  const userEmail = String(user?.email || '').trim();
  const username = String(user?.username || user?.handle || '').trim();
  const displayName = String(user?.name || user?.businessProfile?.name || '').trim();
  const businessName = String(user?.businessProfile?.name || '').trim();

  const input = draft?.input || {};
  const scenes = collectScenes(draft);
  const withImages = scenes.filter((scene) => scene.imageUrl);

  // Attach what we can read off disk; anything else still goes as a link.
  const attachments = [];
  for (const scene of withImages.slice(0, MAX_IMAGE_ATTACHMENTS)) {
    const localPath = localPathForGeneratedMedia(scene.imageUrl);
    const filename = `scene_${String(scene.index).padStart(2, '0')}${path.extname(localPath || scene.imageUrl).split('?')[0] || '.png'}`;
    if (localPath) attachments.push({ filename, path: localPath });
  }

  const sceneBlocks = scenes.map((scene) => `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:10px 0;">
      <p style="margin:0 0 6px;font-weight:700;font-size:13px;color:#111827;">
        Scene ${scene.index}${scene.title ? ` — ${escapeHtml(scene.title)}` : ''}
        ${scene.durationSeconds ? `<span style="font-weight:400;color:#6b7280;"> (${scene.durationSeconds}s)</span>` : ''}
      </p>
      ${scene.scriptLine ? `<p style="margin:4px 0;font-size:13px;color:#111827;"><strong>Line:</strong> ${escapeHtml(scene.scriptLine)}</p>` : ''}
      ${scene.visualDescription ? `<p style="margin:4px 0;font-size:13px;color:#374151;"><strong>Visual:</strong> ${escapeHtml(scene.visualDescription)}</p>` : ''}
      ${(scene.cameraAngle || scene.cameraMovement) ? `<p style="margin:4px 0;font-size:12px;color:#6b7280;">Camera: ${escapeHtml([scene.cameraAngle, scene.cameraMovement].filter(Boolean).join(' · '))}</p>` : ''}
      ${scene.imagePrompt ? `<p style="margin:4px 0;font-size:12px;color:#6b7280;"><strong>Image prompt:</strong> ${escapeHtml(scene.imagePrompt)}</p>` : ''}
      ${scene.imageUrl ? `<p style="margin:6px 0 0;font-size:12px;"><a href="${escapeHtml(scene.imageUrl)}">${escapeHtml(scene.imageUrl)}</a></p>` : '<p style="margin:6px 0 0;font-size:12px;color:#b91c1c;">No image generated for this scene.</p>'}
    </div>`).join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;">
    <h2 style="margin:0;font-size:18px;color:#111827;">New reel video request</h2>
    <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">
      Storyboard and scene images are ready. Clips, audio and the final cut are to be produced manually.
    </p>

    ${section('Requested by', [
      ['Email', userEmail],
      ['Username', username],
      ['Name', displayName],
      ['Business', businessName],
      ['Industry', user?.businessProfile?.industry],
      ['Phone', user?.phone]
    ])}

    ${section('Step 1 — Input', [
      ['Brief', input.description],
      ['Duration', input.durationSeconds ? `${input.durationSeconds} seconds` : ''],
      ['Aspect ratio', input.aspectRatio],
      ['Language', input.languageCode],
      ['Scene count', scenes.length || input.sceneCount],
      ['Product', input.product?.name]
    ])}

    ${section('Step 2 — Character & Video Style', [
      ['Video style', draft?.videoStyle],
      ['Character enabled', draft?.characterEnabled ? 'Yes' : 'No'],
      ['Character name', draft?.characterName],
      ['Age', draft?.characterAge],
      ['Gender', draft?.characterGender],
      ['Role', draft?.characterRole],
      ['Personality', draft?.characterPersonality],
      ['Appearance', draft?.characterAppearance],
      ['Hair', [draft?.characterHairStyle, draft?.characterHairColor].filter(Boolean).join(' · ')],
      ['Clothing', draft?.characterClothing],
      ['Usage', draft?.characterUsage],
      ['Consistency', draft?.characterConsistencyStrength],
      ['Character image', draft?.characterImage]
    ])}

    ${section('Step 3 — Environment', [
      ['Enabled', draft?.input?.environmentEnabled ? 'Yes' : 'No'],
      ['Notes', draft?.input?.environmentNotes],
      ['References', (draft?.input?.environmentRefs || []).length ? `${draft.input.environmentRefs.length} image(s)` : '']
    ])}

    ${section('Step 4 — Script', [
      ['Prompt', draft?.prompt?.promptText],
      ['Voice script', draft?.scenesMetadata?.voiceScript || draft?.scenes?.voiceScript],
      ['Story', draft?.scenes?.story]
    ])}

    <h3 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#92400e;">
      Step 5 — Scene Images (${withImages.length}/${scenes.length} rendered${attachments.length ? `, ${attachments.length} attached` : ''})
    </h3>
    ${sceneBlocks || '<p style="font-size:13px;color:#b91c1c;">No scenes on this draft.</p>'}

    <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
      Job ID: ${escapeHtml(draft?.jobId || '')}${baseUrl ? ` · ${escapeHtml(baseUrl)}` : ''}
    </p>
  </div>`;

  await transporter.sendMail({
    from: `Nebulaa Gravity <${smtpEmail}>`,
    to: HANDOFF_RECIPIENT,
    replyTo: userEmail || undefined,
    subject: `Reel video request — ${businessName || displayName || username || userEmail || 'Unknown user'} (${withImages.length} scene image${withImages.length === 1 ? '' : 's'})`,
    html,
    attachments
  });

  return {
    recipient: HANDOFF_RECIPIENT,
    sceneCount: scenes.length,
    imageCount: withImages.length,
    attachedCount: attachments.length
  };
}

module.exports = {
  sendReelHandoffEmail,
  HANDOFF_RECIPIENT,
};
