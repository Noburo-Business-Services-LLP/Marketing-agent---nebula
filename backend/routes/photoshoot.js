// The Photoshoot studio (docs/superpowers/ops/photoshoot.md):
//   GET    /api/photoshoot/packs                          the packs with prices (from config/apiCosts.js)
//   GET    /api/photoshoot/options                        packs, switch, entitlement, the caller's products and places, photos left today
//   POST   /api/photoshoot/jobs                           { key, pack, productIds[], count?, aspectRatio?, background?, placeId? } -> 202 { job }
//   GET    /api/photoshoot/jobs                           the caller's last 20 photoshoots
//   GET    /api/photoshoot/jobs/:id                       one photoshoot with its photos (polled by the page)
//   POST   /api/photoshoot/jobs/:id/photos/:index/redo    { key } one photo made again, priced as one photo
//   PATCH  /api/photoshoot/jobs/:id/photos/:index         { inLibrary } keep it in the Library or take it out
//   DELETE /api/photoshoot/jobs/:id/photos/:index         delete ONE finished photo for good (not while the photoshoot is running)
//   GET    /api/photoshoot/library                        finished photos kept in the Library
//   POST   /api/photoshoot/upload                         { name, imageData } a product photo, saved as a new product
// Inside an agency client or a CSM pass req.user already is the client, and the charge goes to the wallet that pays for
// it. Every read is filtered by the signed-in account, so one account never sees another's photos.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const { protect } = require('../middleware/auth');

const keyGenerator = (req) => String(req.user?._id || req.user?.id || ipKeyGenerator(req.ip));
const limiter = (max) => rateLimit({
  windowMs: 15 * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, keyGenerator,
  message: { success: false, message: 'You have sent too many requests. Please try again in a few minutes.' }
});
const GENERIC = 'We could not do that just now. Please try again.';

function createPhotoshootRouter(impl = {}) {
  const router = express.Router();
  let service = impl.service || null;
  const svc = () => (service = service || (impl.deps ? require('../services/photoshoot/service').createPhotoshoot(impl.deps) : require('../services/photoshoot').shared()));
  const passOf = (req) => Boolean(req.actingCsm || req.actingAgency);
  const send = (res, out) => res.status(out.status).json(out.body);
  const wrap = (fn) => async (req, res) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      return send(res, await fn(req));
    } catch (err) {
      console.error('[photoshoot] route error:', err && err.message);
      return res.status(500).json({ success: false, message: GENERIC });
    }
  };
  const writeLimit = limiter(60);
  const readLimit = limiter(900);

  router.get('/packs', protect, readLimit, wrap(async () => ({ status: 200, body: { success: true, ...svc().packs() } })));
  router.get('/options', protect, readLimit, wrap(async (req) => ({ status: 200, body: { success: true, ...(await svc().options(req.user, { pass: passOf(req) })) } })));
  router.post('/jobs', protect, writeLimit, wrap((req) => svc().create(req.user, req.body, { pass: passOf(req) })));
  router.get('/jobs', protect, readLimit, wrap((req) => svc().list(req.user)));
  router.get('/jobs/:id', protect, readLimit, wrap((req) => svc().get(req.user, req.params.id)));
  router.post('/jobs/:id/photos/:index/redo', protect, writeLimit, wrap((req) => svc().redo(req.user, req.params.id, req.params.index, req.body, { pass: passOf(req) })));
  router.patch('/jobs/:id/photos/:index', protect, writeLimit, wrap((req) => svc().setInLibrary(req.user, req.params.id, req.params.index, req.body && req.body.inLibrary)));
  router.delete('/jobs/:id/photos/:index', protect, writeLimit, wrap((req) => svc().deletePhoto(req.user, req.params.id, req.params.index)));
  router.get('/library', protect, readLimit, wrap((req) => svc().library(req.user)));
  router.post('/upload', protect, limiter(30), wrap((req) => svc().upload(req.user, req.body, { pass: passOf(req) })));
  return router;
}

const router = createPhotoshootRouter();
router.createPhotoshootRouter = createPhotoshootRouter;
module.exports = router;
