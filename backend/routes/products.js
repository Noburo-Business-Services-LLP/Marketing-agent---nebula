const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

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

module.exports = router;
