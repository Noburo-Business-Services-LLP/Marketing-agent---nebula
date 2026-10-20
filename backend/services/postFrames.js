/**
 * Brand header and footer for posts: two images (for example an address and GST strip, or the branches) that are
 * laid over the top and bottom of a finished post, the same way the logo is. Anything transparent in them stays
 * transparent. Sizes are measured against a 1080 pixel wide post, then scaled to the real width.
 */
const sharp = require('sharp');

const BASE_WIDTH = 1080;
const FRAME_SPECS = {
  header: { width: BASE_WIDTH, height: 140 },
  footer: { width: BASE_WIDTH, height: 200 },
};
const MAX_FRAME_SHARE = 0.3; // a frame never covers more than 30% of the post's height

/** The share of the post's height a frame takes, for telling the image model to keep that band quiet. */
function frameShare(kind, postWidth, postHeight) {
  const spec = FRAME_SPECS[kind];
  if (!spec || !postWidth || !postHeight) return 0;
  const h = Math.round((spec.height * postWidth) / BASE_WIDTH);
  return Math.min(MAX_FRAME_SHARE, h / postHeight);
}

async function fitFrame(buf, kind, postWidth, postHeight) {
  const spec = FRAME_SPECS[kind];
  const h = Math.min(Math.round(postHeight * MAX_FRAME_SHARE), Math.max(8, Math.round((spec.height * postWidth) / BASE_WIDTH)));
  return sharp(buf)
    .resize(postWidth, h, { fit: 'cover', position: kind === 'header' ? 'north' : 'south' })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Composite header and/or footer onto a post. Returns a PNG buffer. */
async function compositeFrames(postBuffer, { header, footer } = {}) {
  const meta = await sharp(postBuffer).metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error('The post image could not be read.');
  const layers = [];
  if (header) {
    const input = await fitFrame(header, 'header', W, H);
    layers.push({ input, left: 0, top: 0 });
  }
  if (footer) {
    const input = await fitFrame(footer, 'footer', W, H);
    const fh = (await sharp(input).metadata()).height;
    layers.push({ input, left: 0, top: H - fh });
  }
  if (!layers.length) return sharp(postBuffer).png().toBuffer();
  return sharp(postBuffer).ensureAlpha().composite(layers).png().toBuffer();
}

/** Cut any picture to a frame's exact shape, for the "crop to size" step in Brand assets. */
async function cropToFrame(buf, kind, position) {
  const spec = FRAME_SPECS[kind];
  if (!spec) throw new Error('Choose header or footer.');
  const focus = ['north', 'centre', 'south', 'west', 'east'].includes(position) ? position : 'centre';
  return sharp(buf).resize(spec.width, spec.height, { fit: 'cover', position: focus }).ensureAlpha().png().toBuffer();
}

async function fetchBuffer(src) {
  const v = String(src || '').trim();
  if (!v) return null;
  if (v.startsWith('data:')) return Buffer.from(v.replace(/^data:image\/[\w+.-]+;base64,/, ''), 'base64');
  if (!/^https:\/\//i.test(v)) return null;
  // SSRF-safe download (services/safeFetch.js): public https only, pinned address, size/time caps, images only.
  const res = await require('./safeFetch').safeFetchResponse(v, { types: ['image/'] });
  if (!res.ok) throw new Error(`frame fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Lay the saved header and footer over a finished image (a link or a data URL) and save the result.
 * Never throws: on any problem the original image is returned so a post is never lost to a frame.
 * `io` injects the network and storage for tests.
 */
async function addFramesToImage(imageSrc, { headerUrl, footerUrl } = {}, io = {}) {
  if (!imageSrc || (!headerUrl && !footerUrl)) return { imageUrl: imageSrc, applied: false };
  const getBuffer = io.fetchBuffer || fetchBuffer;
  const upload = io.upload || ((d) => require('./imageUploader').uploadBase64Image(d, 'nebula-campaign-posts'));
  try {
    const [base, header, footer] = await Promise.all([getBuffer(imageSrc), getBuffer(headerUrl), getBuffer(footerUrl)]);
    if (!base || (!header && !footer)) return { imageUrl: imageSrc, applied: false };
    const out = await compositeFrames(base, { header, footer });
    const dataUrl = `data:image/png;base64,${out.toString('base64')}`;
    const up = await Promise.resolve(upload(dataUrl)).catch(() => null);
    return { imageUrl: (up && up.success && up.url) || dataUrl, preFrameImageUrl: imageSrc, applied: true };
  } catch (err) {
    console.error('[frames] could not add the header and footer:', err && err.message);
    return { imageUrl: imageSrc, applied: false };
  }
}

const POST_HEIGHT_BY_ASPECT = { '1:1': 1080, '4:5': 1350, '9:16': 1920, '16:9': 608, '3:4': 1440 };

/**
 * What to tell the image model so the picture is designed AROUND the header and footer rather than having them
 * dropped over its title: keep exactly those bands free, and let the background run on into them.
 * Empty when there is neither a header nor a footer.
 */
function frameInstruction({ headerUrl, footerUrl, aspectRatio } = {}) {
  const H = POST_HEIGHT_BY_ASPECT[aspectRatio || '1:1'] || 1080;
  const bands = [];
  if (headerUrl) bands.push(`the top ${Math.round(frameShare('header', BASE_WIDTH, H) * 100)}%`);
  if (footerUrl) bands.push(`the bottom ${Math.round(frameShare('footer', BASE_WIDTH, H) * 100)}%`);
  if (!bands.length) return '';
  return `LAYOUT RESERVE: a brand ${headerUrl && footerUrl ? 'header strip and footer strip are' : (headerUrl ? 'header strip is' : 'footer strip is')} added over this picture afterwards. Keep ${bands.join(' and ')} of the picture free of any headline, text, face, product or logo: let the background colour and pattern simply continue there so the strips sit on it naturally. Put every headline, face, product and table fully inside the middle of the frame, with a clear margin from those bands.`;
}

module.exports = { frameInstruction, addFramesToImage, FRAME_SPECS, BASE_WIDTH, frameShare, compositeFrames, cropToFrame };
