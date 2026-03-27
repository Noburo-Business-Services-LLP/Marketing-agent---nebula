const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const XLSX = require('xlsx');
const fetch = require('node-fetch');

// Multer: in-memory storage, allow csv & excel only (max 5 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ];
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(file.mimetype) || ['csv', 'xls', 'xlsx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  }
});

// ============================================
// SHARED: transform + validate a raw CSV/Excel row
// Returns { data } on success or { error } on failure
// ============================================
function transformAndValidateRow(row) {
  const name = (row.name || '').toString().trim();
  if (!name) return { error: 'Product name is required' };
  if (name.length > 100) return { error: 'Product name must be ≤ 100 characters' };

  const price = parseFloat(row.price);
  if (isNaN(price) || price < 0) return { error: 'Price must be a non-negative number' };

  const stockQuantity = parseInt(row.stockQuantity ?? row.stock_quantity ?? row.stock ?? 0, 10);
  if (isNaN(stockQuantity) || stockQuantity < 0) return { error: 'stockQuantity must be a non-negative integer' };

  // Auto-calculate stockStatus (mirrors the pre-save hook)
  let stockStatus;
  if (stockQuantity <= 0) stockStatus = 'out-of-stock';
  else if (stockQuantity < 10) stockStatus = 'low-stock';
  else stockStatus = 'in-stock';

  const description = (row.description || '').toString().trim().substring(0, 500);
  const currency = (row.currency || 'INR').toString().trim() || 'INR';
  const category = (row.category || 'General').toString().trim() || 'General';
  const imageUrl = (row.imageUrl || row.image_url || '').toString().trim();

  // Tags: accept comma-separated string or already an array
  let tags = [];
  const rawTags = row.tags || '';
  if (Array.isArray(rawTags)) {
    tags = rawTags.map(t => t.toString().trim()).filter(Boolean);
  } else {
    tags = rawTags.toString().split(',').map(t => t.trim()).filter(Boolean);
  }

  return {
    data: { name, price, stockQuantity, stockStatus, description, currency, category, imageUrl, tags }
  };
}

// Validation middleware
const validateProduct = [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 100 }),
  body('price').isNumeric().withMessage('Price must be a number').custom(value => value >= 0).withMessage('Price cannot be negative'),
  body('stockQuantity').optional().isInt({ min: 0 }).withMessage('Stock quantity must be a non-negative integer'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        message: errors.array()[0].msg,
        errors: errors.array() 
      });
    }
    next();
  }
];

// @route   GET /api/products
// @desc    Get all products for the logged in user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const { search, category, status } = req.query;
    let query = { user: req.user._id };

    if (search) {
      query.$text = { $search: search };
    }
    if (category) {
      query.category = category;
    }
    if (status) {
      query.stockStatus = status;
    }

    const products = await Product.find(query).sort({ createdAt: -1 });
    res.json({ 
      success: true, 
      count: products.length, 
      data: products 
    });
  } catch (error) {
    console.error('Fetch products error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error fetching products' 
    });
  }
});

// @route   GET /api/products/:id
// @desc    Get a single product
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, user: req.user._id });
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }
    res.json({ 
      success: true, 
      data: product 
    });
  } catch (error) {
    console.error('Fetch product error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error fetching product' 
    });
  }
});

// @route   POST /api/products
// @desc    Create a new product
// @access  Private
router.post('/', protect, validateProduct, async (req, res) => {
  try {
    const { name, price, currency, imageUrl, description, stockQuantity, category, tags } = req.body;
    
    const product = await Product.create({
      user: req.user._id,
      name,
      price,
      currency: currency || 'INR',
      imageUrl,
      description,
      stockQuantity: stockQuantity || 0,
      category: category || 'General',
      tags
    });

    res.status(201).json({ 
      success: true, 
      data: product 
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error creating product' 
    });
  }
});

// @route   POST /api/products/bulk-import
// @desc    Bulk import products from a CSV or Excel file
// @access  Private
router.post('/bulk-import', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Please attach a CSV or Excel file.' });
    }

    // Parse file with xlsx (supports CSV + XLS + XLSX)
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: 'The uploaded file contains no sheets.' });
    }

    const sheet = workbook.Sheets[sheetName];
    // defval: '' ensures empty cells become empty strings instead of undefined
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'The file is empty or has no data rows.' });
    }

    const MAX_ROWS = 500;
    const processedRows = rows.slice(0, MAX_ROWS);

    const successes = [];
    const failures  = [];

    for (let i = 0; i < processedRows.length; i++) {
      const row = processedRows[i];
      const rowNum = i + 2; // +2 because row 1 = header, arrays are 0-indexed

      const result = transformAndValidateRow(row);

      if (result.error) {
        failures.push({ row: rowNum, reason: result.error, data: row });
        continue;
      }

      try {
        const product = await Product.create({
          user: req.user._id,
          ...result.data
        });
        successes.push({ row: rowNum, productId: product._id, name: product.name });
      } catch (dbErr) {
        failures.push({ row: rowNum, reason: dbErr.message || 'Database error', data: row });
      }
    }

    const truncated = rows.length > MAX_ROWS;

    return res.status(207).json({
      success: true,
      summary: {
        total:    processedRows.length,
        imported: successes.length,
        failed:   failures.length,
        truncated,
        truncatedAt: truncated ? MAX_ROWS : undefined
      },
      successes,
      failures
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    // Handle multer errors (file type / size)
    if (error.message && error.message.includes('Only CSV')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Server error during bulk import' });
  }
});

// @route   PUT /api/products/:id
// @desc    Update a product
// @access  Private
router.put('/:id', protect, validateProduct, async (req, res) => {
  try {
    let product = await Product.findOne({ _id: req.params.id, user: req.user._id });
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    const { name, price, currency, imageUrl, description, stockQuantity, category, tags } = req.body;
    
    product.name = name;
    product.price = price;
    if (currency) product.currency = currency;
    if (imageUrl !== undefined) product.imageUrl = imageUrl;
    if (description !== undefined) product.description = description;
    if (stockQuantity !== undefined) product.stockQuantity = stockQuantity;
    if (category) product.category = category;
    if (tags) product.tags = tags;

    await product.save();

    res.json({ 
      success: true, 
      data: product 
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error updating product' 
    });
  }
});

// @route   DELETE /api/products/:id
// @desc    Delete a product
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    
    if (!product) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Product removed' 
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error deleting product' 
    });
  }
});

// @route   POST /api/products/:id/generate-ad-image
// @desc    Generate a premium social-media ad image for a product using AI
// @access  Private
router.post('/:id/generate-ad-image', protect, async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, user: req.user._id });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { platform = 'instagram', tone = 'professional', aspectRatio = '1:1' } = req.body;

    // ── Build the detailed creative prompt ──────────────────────────────────
    const productContext = [
      `Product Name: ${product.name}`,
      product.description ? `Description: ${product.description}` : null,
      `Category: ${product.category || 'General'}`,
      `Price: ${product.currency || 'INR'} ${product.price}`,
      product.tags?.length ? `Keywords / Tags: ${product.tags.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const hasReferenceImage = product.imageUrl &&
      (product.imageUrl.startsWith('http') || product.imageUrl.startsWith('data:'));

    const imageDescription = `
ROLE: Elite Commercial Product Photographer.
TASK: Generate a high-quality marketing advertisement image using the provided product reference image.

STRICT RULES:
1. PRODUCT LOCK: You MUST use the reference image as the exact product. Preserve the exact product appearance, design, shape, color, and structure.
2. NO ALTERATION: DO NOT change the product design or structure. DO NOT replace the product with a different object or scene.
3. NO HUMAN ELEMENTS: DO NOT introduce people, faces, or hands. DO NOT generate lifestyle-only images without the product.
4. VISIBILITY: The product must be clearly visible, centered, and the primary subject of the image.
5. BACKGROUND: Place the product in a clean marketing background (high-end studio, minimal, or soft lifestyle). The background must support the product, not replace or distract from it.

AESTHETIC GUIDELINES:
- LIGHTING: Professional commercial lighting with realistic shadows and crisp highlights.
- FOCUS: Sharp focus on the product, no hallucinated variations.
- PLATFORM STYLE:
  * Instagram -> vibrant, aesthetic, modern.
  * LinkedIn/Ads -> clean, professional, high contrast, premium.

GOAL: A photorealistic, agency-grade social media ad in ${aspectRatio} aspect ratio for ${platform}.
`.trim();

    // Lazy-import to avoid circular deps
    const { generateCampaignImageNanoBanana } = require('../services/geminiAI');

    // If a reference image URL exists, fetch it and pass as base64 so the model
    // can see the real product and match its appearance exactly.
    let brandLogo = null;
    if (hasReferenceImage && product.imageUrl.startsWith('http')) {
      try {
        console.log(`📥 Fetching product reference image: ${product.imageUrl}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const imgResp = await fetch(product.imageUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (imgResp.ok) {
          const buf = await imgResp.arrayBuffer();
          const mime = imgResp.headers.get('content-type') || 'image/jpeg';
          brandLogo = `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
          console.log('✅ Product reference image fetched and encoded');
        }
      } catch (fetchErr) {
        console.warn('⚠️ Could not fetch product reference image:', fetchErr.message);
      }
    } else if (hasReferenceImage && product.imageUrl.startsWith('data:')) {
      brandLogo = product.imageUrl; // already base64
    }

    console.log(`🎨 Generating product ad image for "${product.name}" (${platform}, ${aspectRatio})`);

    const result = await generateCampaignImageNanoBanana(imageDescription, {
      aspectRatio,
      brandName:     product.name,
      brandLogo,          // product photo used as reference, not as logo overlay
      industry:      product.category || 'Retail',
      tone,
      postIndex:     0,
      totalPosts:    1,
      campaignTheme: `${product.name} Product Ad`,
      keyMessages:   product.description || '',
      linkedProduct: {
        name:        product.name,
        description: product.description || '',
        price:       product.price,
        currency:    product.currency || 'INR',
      }
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Image generation failed'
      });
    }

    return res.json({
      success: true,
      imageUrl: result.imageUrl,
      model:    result.model,
      product: {
        _id:      product._id,
        name:     product.name,
        category: product.category,
        price:    product.price,
        currency: product.currency
      }
    });

  } catch (error) {
    console.error('Product ad image generation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error generating ad image'
    });
  }
});

module.exports = router;
