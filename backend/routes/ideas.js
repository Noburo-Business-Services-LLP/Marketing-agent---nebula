const express = require('express');
const router = express.Router();
const ContentIdea = require('../models/ContentIdea');
const { protect } = require('../middleware/auth');
const { uploadBase64Image } = require('../services/imageUploader');

function getUserId(req) {
  return req.user?._id || req.user?.id || req.user?.userId || null;
}

// GET /api/ideas — the inbox. `status` filters (default: everything that
// isn't dismissed, since dismissed ideas are done, not gone).
router.get('/', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { status } = req.query;
    const filter = { userId };
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $ne: 'dismissed' };
    }
    const ideas = await ContentIdea.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, ideas });
  } catch (error) {
    console.error('Error listing content ideas:', error);
    res.status(500).json({ success: false, message: 'Failed to load ideas' });
  }
});

// POST /api/ideas — one idea, typed or pasted by hand.
router.post('/', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { text, imageData, sourceUrl, targetDate } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ success: false, message: 'Idea text is required' });
    }

    let imageUrl = '';
    if (imageData) {
      const uploadResult = await uploadBase64Image(imageData, 'nebula-idea-inbox');
      if (uploadResult.success) imageUrl = uploadResult.url;
      // A failed image upload shouldn't lose the idea itself — the text is
      // the part that matters; the image is a nice-to-have reference.
    }

    const idea = await ContentIdea.create({
      userId,
      text: String(text).trim(),
      imageUrl,
      sourceUrl: sourceUrl ? String(sourceUrl).trim() : '',
      targetDate: targetDate ? new Date(targetDate) : null,
      source: 'manual'
    });

    res.status(201).json({ success: true, idea });
  } catch (error) {
    console.error('Error creating content idea:', error);
    res.status(500).json({ success: false, message: 'Failed to save idea' });
  }
});

// POST /api/ideas/bulk — many at once, from a pasted list or a parsed
// spreadsheet. Parsing itself (splitting lines, reading the .xlsx/.csv
// file) happens client-side with the xlsx package already in the frontend
// bundle; this endpoint just takes the resulting array of strings and
// writes them as individual ideas, same as if each had been typed by hand.
router.post('/bulk', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { items, source } = req.body || {};
    const list = Array.isArray(items) ? items : [];
    const cleaned = list
      .map((raw) => (typeof raw === 'string' ? raw : raw?.text))
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      // A generous but real ceiling — protects against a malformed paste
      // (e.g. an entire spreadsheet pasted as one blob) creating thousands
      // of one-character "ideas".
      .slice(0, 500);

    if (cleaned.length === 0) {
      return res.status(400).json({ success: false, message: 'No idea text found to import' });
    }

    const docs = cleaned.map((text) => ({
      userId,
      text,
      source: source === 'bulk_file' ? 'bulk_file' : 'bulk_paste'
    }));
    const created = await ContentIdea.insertMany(docs);

    res.status(201).json({ success: true, count: created.length, ideas: created });
  } catch (error) {
    console.error('Error bulk-importing content ideas:', error);
    res.status(500).json({ success: false, message: 'Failed to import ideas' });
  }
});

// PATCH /api/ideas/:id — dismiss, or record that it was turned into a draft.
router.patch('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { status, draftId } = req.body || {};
    const idea = await ContentIdea.findOne({ _id: req.params.id, userId });
    if (!idea) return res.status(404).json({ success: false, message: 'Idea not found' });

    if (status && ['new', 'expanded', 'dismissed'].includes(status)) idea.status = status;
    if (draftId) idea.draftId = draftId;
    await idea.save();

    res.json({ success: true, idea });
  } catch (error) {
    console.error('Error updating content idea:', error);
    res.status(500).json({ success: false, message: 'Failed to update idea' });
  }
});

// DELETE /api/ideas/:id — actually remove, distinct from dismiss (which
// keeps it around, filtered out of the default view).
router.delete('/:id', protect, async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await ContentIdea.deleteOne({ _id: req.params.id, userId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Idea not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting content idea:', error);
    res.status(500).json({ success: false, message: 'Failed to delete idea' });
  }
});

module.exports = router;
