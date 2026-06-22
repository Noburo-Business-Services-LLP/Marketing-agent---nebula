import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, Search, Edit, Trash2, Box, Package, 
  Filter, Download, ChevronRight, Loader2, 
  Image as ImageIcon, MoreVertical, AlertCircle,
  Tag, BarChart3, Clock, Check, X, Upload,
  FileSpreadsheet, CheckCircle2, XCircle, Info, Sparkles, ExternalLink, 
  DownloadCloud, ImagePlus, Monitor, Smartphone, Linkedin, Instagram
} from 'lucide-react';
import { inventoryAPI } from '../services/api';
import { Product } from '../types';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

const Inventory: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // AI Ad Generation State
  const [showAdModal, setShowAdModal] = useState(false);
  const [isGeneratingAd, setIsGeneratingAd] = useState(false);
  const [selectedAdProduct, setSelectedAdProduct] = useState<Product | null>(null);
  const [generatedAdUrl, setGeneratedAdUrl] = useState<string | null>(null);
  const [adOptions, setAdOptions] = useState({
    platform: 'instagram',
    tone: 'professional',
    aspectRatio: '1:1'
  });

  // Bulk Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<{
    summary: { total: number; imported: number; failed: number; truncated: boolean; truncatedAt?: number };
    successes: { row: number; productId: string; name: string }[];
    failures: { row: number; reason: string; data: any }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    currency: 'USD',
    imageUrl: '',
    stockQuantity: '',
    category: '',
    tags: ''
  });

  const categories = ['all', ...Array.from(new Set(products.map(p => p.category)))].filter(Boolean);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const response = await inventoryAPI.getProducts();
      if (response.success) {
        setProducts(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setFormData({
      name: '',
      description: '',
      price: '',
      currency: 'USD',
      imageUrl: '',
      stockQuantity: '',
      category: '',
      tags: ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      price: product.price.toString(),
      currency: product.currency || 'USD',
      imageUrl: product.imageUrl || '',
      stockQuantity: product.stockQuantity?.toString() || '',
      category: product.category || '',
      tags: product.tags?.join(', ') || ''
    });
    setShowAddModal(true);
  };

  const handleDelete = async (productId: string) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    
    try {
      const response = await inventoryAPI.deleteProduct(productId);
      if (response.success) {
        setProducts(prev => prev.filter(p => p._id !== productId));
      }
    } catch (err) {
      console.error('Failed to delete product:', err);
      alert('Failed to delete product');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    const payload = {
      ...formData,
      price: parseFloat(formData.price),
      stockQuantity: parseInt(formData.stockQuantity) || 0,
      tags: formData.tags.split(',').map(tag => tag.trim()).filter(Boolean)
    };

    try {
      let response;
      if (editingProduct) {
        response = await inventoryAPI.updateProduct(editingProduct._id, payload);
      } else {
        response = await inventoryAPI.createProduct(payload);
      }

      if (response.success) {
        fetchProducts();
        setShowAddModal(false);
      }
    } catch (err) {
      console.error('Failed to save product:', err);
      alert('Failed to save product. Please check your inputs.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenAdGenerator = (product: Product) => {
    setSelectedAdProduct(product);
    setGeneratedAdUrl(null);
    setShowAdModal(true);
  };

  const handleGenerateAd = async () => {
    if (!selectedAdProduct) return;
    
    setIsGeneratingAd(true);
    setGeneratedAdUrl(null);
    
    try {
      const response = await inventoryAPI.generateProductAdImage(selectedAdProduct._id, adOptions);
      if (response.success && response.imageUrl) {
        setGeneratedAdUrl(response.imageUrl);
      } else {
        alert(response.message || 'Failed to generate ad image');
      }
    } catch (err) {
      console.error('Ad generation error:', err);
      alert('An error occurred while generating the ad image');
    } finally {
      setIsGeneratingAd(false);
    }
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download error:', err);
      window.open(url, '_blank');
    }
  };

  // ── Bulk Import Handlers ────────────────────────────────────────────────
  const handleFileSelect = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'xls', 'xlsx'].includes(ext || '')) {
      alert('Please select a valid CSV or Excel file (.csv, .xls, .xlsx)');
      return;
    }
    setImportFile(file);
    setImportResult(null);
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, []);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleImport = async () => {
    if (!importFile) return;
    setIsImporting(true);
    try {
      const result = await inventoryAPI.bulkImportProducts(importFile);
      setImportResult({
        summary: result.summary,
        successes: result.successes || [],
        failures: result.failures || [],
      });
      if (result.summary.imported > 0) {
        fetchProducts(); // refresh the product list immediately
      }
    } catch (err: any) {
      alert(err.message || 'Import failed. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloseImport = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportResult(null);
    setIsDragging(false);
  };
  // ─────────────────────────────────────────────────────────────────────────

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.category?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getStockColor = (status: string) => {
    switch (status) {
      case 'in-stock': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'low-stock': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'out-of-stock': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
  };

  const inputClasses = `w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all ${
    isDarkMode ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900'
  }`;

  const labelClasses = `block text-xs font-bold uppercase tracking-wide mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

  return (
    <div className={`p-6 min-h-screen ${isDarkMode ? 'bg-[#070A12]' : 'bg-slate-50'}`}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h1 className={`text-3xl font-black tracking-tight flex items-center gap-3 ${theme.text}`}>
            <Package className="w-8 h-8 text-[#ffcc29]" />
            Inventory <span className="text-slate-500 font-light">Management</span>
          </h1>
          <p className={`text-sm mt-1 font-medium ${theme.textSecondary}`}>
            Manage your products and their stock levels for marketing campaigns.
          </p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          <button 
            onClick={fetchProducts}
            className={`p-2.5 rounded-xl border transition-all hover:scale-105 active:scale-95 ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
            }`}
            title="Refresh"
          >
            <Clock className="w-5 h-5" />
          </button>

          {/* Import CSV/Excel button */}
          <button
            onClick={() => { setShowImportModal(true); setImportResult(null); setImportFile(null); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-[#ffcc29]/50 hover:text-[#ffcc29]'
                : 'bg-white border-slate-200 text-slate-700 hover:border-[#ffcc29] hover:text-[#ffcc29]'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Import CSV / Excel
          </button>

          <button 
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black font-bold rounded-xl shadow-lg shadow-[#ffcc29]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Plus className="w-5 h-5" />
            Add Product
          </button>
        </div>
      </div>

      {/* Stats Quick View */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Products', value: products.length, icon: Box, color: 'text-blue-500' },
          { label: 'In Stock', value: products.filter(p => p.stockStatus === 'in-stock').length, icon: Check, color: 'text-green-500' },
          { label: 'Low Stock', value: products.filter(p => p.stockStatus === 'low-stock').length, icon: AlertCircle, color: 'text-yellow-500' },
          { label: 'Out of Stock', value: products.filter(p => p.stockStatus === 'out-of-stock').length, icon: X, color: 'text-red-500' },
        ].map((stat, i) => (
          <div key={i} className={`p-4 rounded-2xl border shadow-sm flex items-center justify-between ${theme.bgCard} ${isDarkMode ? 'border-slate-800/50' : 'border-slate-200/50'}`}>
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.textMuted}`}>{stat.label}</p>
              <p className={`text-xl font-black ${theme.text}`}>{stat.value}</p>
            </div>
            <div className={`p-3 rounded-xl bg-opacity-10 ${stat.color} bg-current`}>
              <stat.icon className="w-5 h-5" />
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className={`mb-6 p-4 rounded-2xl border shadow-sm flex flex-col md:flex-row items-center gap-4 ${theme.bgCard} ${isDarkMode ? 'border-slate-800/50' : 'border-slate-200/50'}`}>
        <div className="relative flex-1 w-full">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
          <input 
            type="text" 
            placeholder="Search within your inventory..."
            className={`w-full pl-10 pr-4 py-2 text-sm rounded-xl outline-none border transition-all ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white focus:border-[#ffcc29]' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-[#ffcc29]'
            }`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Filter className={`w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
          <select 
            className={`px-4 py-2 text-sm rounded-xl border outline-none transition-all ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
            }`}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {categories.map(c => (
              <option key={c} value={c} className="capitalize">{c === 'all' ? 'All Categories' : c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Product List Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-slate-700 border-t-[#ffcc29] animate-spin" />
            <Package className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-[#ffcc29]" />
          </div>
          <p className={`text-sm font-medium animate-pulse ${theme.textSecondary}`}>Syncing your inventory...</p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className={`p-20 text-center rounded-3xl border border-dashed ${isDarkMode ? 'border-slate-800 bg-slate-900/20' : 'border-slate-200 bg-white'}`}>
          <div className="inline-flex p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-6">
            <Package className="w-12 h-12 text-slate-400" />
          </div>
          <h2 className={`text-xl font-bold ${theme.text}`}>Your inventory is empty</h2>
          <p className={`text-sm mt-2 max-w-sm mx-auto ${theme.textSecondary}`}>
            Start by adding your first product to link it with AI-powered marketing campaigns.
          </p>
          <button 
            onClick={handleOpenAdd}
            className="mt-6 px-6 py-3 bg-[#ffcc29] text-black font-bold rounded-xl hover:bg-[#ffcc29]/90 transition-all active:scale-95"
          >
            Add New Product
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map(product => (
            <div 
              key={product._id} 
              className={`group rounded-2xl border shadow-sm overflow-hidden transition-all duration-300 hover:shadow-xl hover:translate-y-[-4px] ${theme.bgCard} ${isDarkMode ? 'border-slate-800/50 hover:border-[#ffcc29]/30' : 'border-slate-200/50 hover:border-[#ffcc29]/30'}`}
            >
              {/* Product Image Container */}
              <div className="relative h-56 overflow-hidden bg-slate-100">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300">
                    <ImageIcon className="w-16 h-16" />
                  </div>
                )}
                
                {/* Stock Status Badge */}
                <div className={`absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border backdrop-blur-md shadow-lg ${getStockColor(product.stockStatus)}`}>
                  {product.stockStatus.replace('-', ' ')}
                </div>

                {/* Quick Actions Overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button 
                    onClick={() => handleOpenAdGenerator(product)}
                    className="p-3 bg-[#ffcc29] rounded-xl text-slate-900 hover:bg-white transition-colors shadow-lg group/btn"
                    title="Generate AI Ad Image"
                  >
                    <Sparkles className="w-5 h-5 group-hover/btn:animate-pulse" />
                  </button>
                  <button 
                    onClick={() => handleOpenEdit(product)}
                    className="p-3 bg-white rounded-xl text-slate-800 hover:bg-[#ffcc29] transition-colors shadow-lg"
                    title="Edit Product"
                  >
                    <Edit className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleDelete(product._id)}
                    className="p-3 bg-red-500 rounded-xl text-white hover:bg-red-600 transition-colors shadow-lg"
                    title="Delete Product"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Product Details Content */}
              <div className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <h3 className={`font-bold text-lg truncate ${theme.text}`}>{product.name}</h3>
                  <div className={`p-1.5 rounded-lg ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-100'} transition-colors cursor-pointer`}>
                    <MoreVertical className={`w-4 h-4 ${theme.textMuted}`} />
                  </div>
                </div>
                
                <p className={`text-xs line-clamp-2 mb-4 h-8 ${theme.textSecondary}`}>
                  {product.description || 'No description provided.'}
                </p>

                <div className="flex items-center gap-2 mb-6 overflow-x-hidden">
                  {product.category && (
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                      {product.category}
                    </span>
                  )}
                  {product.tags?.slice(0, 2).map((tag, i) => (
                    <span key={i} className={`px-2 py-1 rounded-lg text-[10px] font-bold ${isDarkMode ? 'bg-slate-800 text-[#ffcc29]/70' : 'bg-slate-100 text-[#ffcc29]'}`}>
                      #{tag}
                    </span>
                  ))}
                </div>

                <div className={`flex items-center justify-between pt-4 border-t ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.textMuted}`}>PRICE</p>
                    <p className="text-xl font-black text-[#ffcc29]">
                      <span className="text-xs font-bold mr-0.5">{product.currency || 'USD'}</span>
                      {product.price}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${theme.textMuted}`}>STOCK</p>
                    <p className={`text-sm font-black ${theme.text}`}>{product.stockQuantity || 0} pcs</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className={`relative w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${theme.bgCard} animate-in slide-in-from-bottom-4 duration-500`}>
            {/* Modal Header */}
            <div className={`px-8 py-6 border-b flex items-center justify-between ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-[#ffcc29]/10 border border-[#ffcc29]/20">
                  {editingProduct ? <Edit className="w-6 h-6 text-[#ffcc29]" /> : <Plus className="w-6 h-6 text-[#ffcc29]" />}
                </div>
                <div>
                  <h3 className={`text-xl font-black ${theme.text}`}>{editingProduct ? 'Edit Product' : 'Add New Product'}</h3>
                  <p className={`text-xs font-medium ${theme.textSecondary}`}>Fill in the details to update your inventory catalogue.</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className={`p-2 rounded-xl transition-all ${isDarkMode ? 'hover:bg-slate-700 text-slate-400' : 'hover:bg-slate-200 text-slate-500'}`}
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Form Content */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className={labelClasses}>Product Name *</label>
                  <input 
                    required 
                    className={inputClasses} 
                    placeholder="e.g. Ultra Wireless Headphones"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className={labelClasses}>Description</label>
                  <textarea 
                    className={`${inputClasses} resize-none`} 
                    rows={3}
                    placeholder="Provide a detailed description of the product..."
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>
                
                <div>
                  <label className={labelClasses}>Price *</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span>
                    <input 
                      required 
                      type="number" 
                      step="0.01"
                      className={`${inputClasses} pl-8`} 
                      placeholder="0.00"
                      value={formData.price}
                      onChange={(e) => setFormData({...formData, price: e.target.value})}
                    />
                  </div>
                </div>
                
                <div>
                  <label className={labelClasses}>Initial Stock *</label>
                  <input 
                    required
                    type="number" 
                    className={inputClasses} 
                    placeholder="0"
                    value={formData.stockQuantity}
                    onChange={(e) => setFormData({...formData, stockQuantity: e.target.value})}
                  />
                </div>
                
                <div>
                  <label className={labelClasses}>Category</label>
                  <input 
                    className={inputClasses} 
                    placeholder="e.g. Electronics, Clothing"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  />
                </div>
                
                <div>
                  <label className={labelClasses}>Tags (comma separated)</label>
                  <input 
                    className={inputClasses} 
                    placeholder="e.g. new, featured, hotsale"
                    value={formData.tags}
                    onChange={(e) => setFormData({...formData, tags: e.target.value})}
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className={labelClasses}>Product Image URL</label>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <input 
                        className={inputClasses} 
                        placeholder="Paste image URL here..."
                        value={formData.imageUrl}
                        onChange={(e) => setFormData({...formData, imageUrl: e.target.value})}
                      />
                    </div>
                    {formData.imageUrl && (
                      <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-700">
                        <img src={formData.imageUrl} className="w-full h-full object-cover" alt="Preview" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="mt-10 flex items-center justify-end gap-3 pt-6 border-t border-slate-800">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`px-6 py-3 rounded-xl font-bold transition-all ${
                    isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
                  }`}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isSaving}
                  className="px-8 py-3 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black font-black rounded-xl shadow-lg shadow-[#ffcc29]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingProduct ? 'Update Product' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Bulk Import Modal ────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className={`relative w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
            isDarkMode ? 'bg-[#0d1117] border border-slate-800' : 'bg-white border border-slate-200'
          } animate-in slide-in-from-bottom-4 duration-500`}>

            {/* Modal Header */}
            <div className={`px-8 py-5 border-b flex items-center justify-between flex-shrink-0 ${
              isDarkMode ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-[#ffcc29]/10 border border-[#ffcc29]/20">
                  <Upload className="w-5 h-5 text-[#ffcc29]" />
                </div>
                <div>
                  <h3 className={`text-lg font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                    Bulk Import Products
                  </h3>
                  <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    Upload a CSV or Excel file — up to 500 products at once
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseImport}
                className={`p-2 rounded-xl transition-all ${
                  isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500'
                }`}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">

              {/* Required columns info */}
              <div className={`flex gap-3 p-4 rounded-2xl border text-sm ${
                isDarkMode ? 'bg-blue-900/10 border-blue-500/20 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-bold mb-1">Required columns in your file:</p>
                  <p className="font-mono text-xs leading-relaxed">
                    <span className="font-bold">name</span>, <span className="font-bold">price</span>
                    {' '}— Optional: description, currency, stockQuantity, category, tags, imageUrl
                  </p>
                  <a
                    href="data:text/csv;charset=utf-8,name%2Cdescription%2Cprice%2Ccurrency%2CstockQuantity%2Ccategory%2Ctags%2CimageUrl%0AExample%20Product%2CA%20sample%20product%2C99.99%2CINR%2C50%2CElectronics%2Cnew%2Cfeatured%2Chttps%3A%2F%2Fexample.com%2Fimg.jpg"
                    download="product_import_template.csv"
                    className="inline-flex items-center gap-1 mt-2 text-xs font-bold underline underline-offset-2 hover:no-underline"
                  >
                    <Download className="w-3 h-3" />
                    Download sample template
                  </a>
                </div>
              </div>

              {/* Drop zone */}
              {!importResult && (
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                    isDragging
                      ? 'border-[#ffcc29] bg-[#ffcc29]/5 scale-[1.01]'
                      : importFile
                      ? isDarkMode ? 'border-green-500/40 bg-green-500/5' : 'border-green-400 bg-green-50'
                      : isDarkMode ? 'border-slate-700 hover:border-[#ffcc29]/50 hover:bg-[#ffcc29]/5' : 'border-slate-200 hover:border-[#ffcc29] hover:bg-[#ffcc29]/5'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }}
                  />

                  {importFile ? (
                    <>
                      <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
                        <FileSpreadsheet className="w-8 h-8 text-green-500" />
                      </div>
                      <div className="text-center">
                        <p className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                          {importFile.name}
                        </p>
                        <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                          {(importFile.size / 1024).toFixed(1)} KB &mdash; click to change file
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className={`p-4 rounded-2xl border ${
                        isDragging ? 'bg-[#ffcc29]/10 border-[#ffcc29]/30' : isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
                      }`}>
                        <Upload className={`w-8 h-8 ${isDragging ? 'text-[#ffcc29]' : isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                      </div>
                      <div className="text-center">
                        <p className={`font-bold text-sm ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
                          {isDragging ? 'Drop your file here' : 'Drag & drop or click to browse'}
                        </p>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                          Accepts .csv, .xls, .xlsx — max 5 MB
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Import Results ── */}
              {importResult && (
                <div className="space-y-4">
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Total Rows',
                        value: importResult.summary.total,
                        icon: FileSpreadsheet,
                        color: 'text-blue-400',
                        bg: isDarkMode ? 'bg-blue-900/15 border-blue-800/40' : 'bg-blue-50 border-blue-200'
                      },
                      {
                        label: 'Imported',
                        value: importResult.summary.imported,
                        icon: CheckCircle2,
                        color: 'text-green-400',
                        bg: isDarkMode ? 'bg-green-900/15 border-green-800/40' : 'bg-green-50 border-green-200'
                      },
                      {
                        label: 'Failed',
                        value: importResult.summary.failed,
                        icon: XCircle,
                        color: 'text-red-400',
                        bg: isDarkMode ? 'bg-red-900/15 border-red-800/40' : 'bg-red-50 border-red-200'
                      },
                    ].map(stat => (
                      <div key={stat.label} className={`p-4 rounded-2xl border flex flex-col gap-1 ${stat.bg}`}>
                        <stat.icon className={`w-5 h-5 ${stat.color}`} />
                        <p className={`text-2xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{stat.value}</p>
                        <p className={`text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{stat.label}</p>
                      </div>
                    ))}
                  </div>

                  {importResult.summary.truncated && (
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-medium ${
                      isDarkMode ? 'bg-yellow-900/15 border border-yellow-700/30 text-yellow-300' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
                    }`}>
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      File exceeded 500 rows. Only the first 500 rows were processed.
                    </div>
                  )}

                  {/* Success list (collapsed) */}
                  {importResult.successes.length > 0 && (
                    <details className={`rounded-2xl border overflow-hidden ${
                      isDarkMode ? 'border-green-800/40' : 'border-green-200'
                    }`}>
                      <summary className={`flex items-center gap-2 px-5 py-3 cursor-pointer select-none font-bold text-sm ${
                        isDarkMode ? 'bg-green-900/15 text-green-400' : 'bg-green-50 text-green-700'
                      }`}>
                        <CheckCircle2 className="w-4 h-4" />
                        {importResult.successes.length} product{importResult.successes.length !== 1 ? 's' : ''} imported successfully
                      </summary>
                      <div className={`max-h-40 overflow-y-auto divide-y text-xs ${
                        isDarkMode ? 'divide-slate-800 bg-green-950/10' : 'divide-green-100 bg-white'
                      }`}>
                        {importResult.successes.map(s => (
                          <div key={s.productId} className={`flex items-center justify-between px-5 py-2 ${
                            isDarkMode ? 'text-slate-300' : 'text-slate-600'
                          }`}>
                            <span className="font-medium">Row {s.row}: {s.name}</span>
                            <span className={`font-mono text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{s.productId}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Failure list */}
                  {importResult.failures.length > 0 && (
                    <details open className={`rounded-2xl border overflow-hidden ${
                      isDarkMode ? 'border-red-800/40' : 'border-red-200'
                    }`}>
                      <summary className={`flex items-center gap-2 px-5 py-3 cursor-pointer select-none font-bold text-sm ${
                        isDarkMode ? 'bg-red-900/15 text-red-400' : 'bg-red-50 text-red-600'
                      }`}>
                        <XCircle className="w-4 h-4" />
                        {importResult.failures.length} row{importResult.failures.length !== 1 ? 's' : ''} failed — click to review
                      </summary>
                      <div className={`max-h-48 overflow-y-auto divide-y text-xs ${
                        isDarkMode ? 'divide-slate-800 bg-red-950/10' : 'divide-red-100 bg-white'
                      }`}>
                        {importResult.failures.map((f, idx) => (
                          <div key={idx} className={`px-5 py-2.5 ${
                            isDarkMode ? 'text-slate-300' : 'text-slate-600'
                          }`}>
                            <span className={`font-bold ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>Row {f.row}:</span>{' '}
                            {f.reason}
                            {f.data?.name ? (
                              <span className={`ml-1 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                                (name: "{f.data.name}")
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Import another file */}
                  <button
                    onClick={() => { setImportFile(null); setImportResult(null); }}
                    className={`w-full py-2.5 rounded-xl border text-sm font-bold transition-all ${
                      isDarkMode ? 'border-slate-700 text-slate-400 hover:border-[#ffcc29]/40 hover:text-[#ffcc29]' : 'border-slate-200 text-slate-500 hover:border-[#ffcc29] hover:text-[#ffcc29]'
                    }`}
                  >
                    Import another file
                  </button>
                </div>
              )}
            </div>

            {/* Footer actions */}
            {!importResult && (
              <div className={`px-8 py-5 border-t flex items-center justify-end gap-3 flex-shrink-0 ${
                isDarkMode ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50'
              }`}>
                <button
                  type="button"
                  onClick={handleCloseImport}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
                    isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!importFile || isImporting}
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black font-black text-sm rounded-xl shadow-lg shadow-[#ffcc29]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Import Products</>
                  )}
                </button>
              </div>
            )}

            {importResult && (
              <div className={`px-8 py-5 border-t flex items-center justify-end flex-shrink-0 ${
                isDarkMode ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50'
              }`}>
                <button
                  type="button"
                  onClick={handleCloseImport}
                  className="px-6 py-2.5 bg-gradient-to-r from-[#ffcc29] to-[#ffa500] text-black font-black text-sm rounded-xl shadow-lg shadow-[#ffcc29]/20 hover:shadow-xl transition-all"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI Ad Generator Modal */}
      {showAdModal && selectedAdProduct && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-300">
          <div className={`relative w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col md:flex-row h-auto max-h-[90vh] ${theme.bgCard} border border-white/10 animate-in zoom-in-95 duration-500`}>
            
            {/* Modal Left Side - Controls */}
            <div className={`w-full md:w-[380px] p-8 flex flex-col gap-8 border-r ${isDarkMode ? 'bg-slate-900/50 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-[#ffcc29]/20 border border-[#ffcc29]/30">
                    <Sparkles className="w-6 h-6 text-[#ffcc29]" />
                  </div>
                  <h3 className={`text-xl font-black ${theme.text}`}>AI Ad Studio</h3>
                </div>
                <button 
                  onClick={() => setShowAdModal(false)}
                  className={`md:hidden p-2 rounded-xl ${isDarkMode ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-200 text-slate-500'}`}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 ${theme.textMuted}`}>Platform</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: 'instagram', icon: Instagram, label: 'Instagram' },
                    { id: 'linkedin', icon: Linkedin, label: 'LinkedIn' },
                    { id: 'facebook', icon: Box, label: 'Facebook' },
                    { id: 'marketing', icon: Monitor, label: 'General' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setAdOptions(prev => ({ ...prev, platform: p.id }))}
                      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${
                        adOptions.platform === p.id 
                          ? 'bg-[#ffcc29]/10 border-[#ffcc29] text-[#ffcc29]' 
                          : `${isDarkMode ? 'bg-slate-800/50 border-white/5 text-slate-400' : 'bg-white border-slate-200 text-slate-600'} hover:border-slate-400`
                      }`}
                    >
                      <p.icon className="w-4 h-4" />
                      <span className="text-xs font-bold">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 ${theme.textMuted}`}>Brand Tone</p>
                <div className="grid grid-cols-2 gap-3">
                  {['Professional', 'Luxurious', 'Playful', 'Minimalist'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setAdOptions(prev => ({ ...prev, tone: t.toLowerCase() }))}
                      className={`p-3 rounded-2xl border text-xs font-bold transition-all ${
                        adOptions.tone === t.toLowerCase() 
                          ? 'bg-[#ffcc29]/10 border-[#ffcc29] text-[#ffcc29]' 
                          : `${isDarkMode ? 'bg-slate-800/50 border-white/5 text-slate-400' : 'bg-white border-slate-200 text-slate-600'} hover:border-slate-400`
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.2em] mb-4 ${theme.textMuted}`}>Aspect Ratio</p>
                <div className="flex gap-4">
                  {[
                    { id: '1:1', icon: Smartphone, label: 'Square' },
                    { id: '9:16', icon: Smartphone, label: 'Stories' },
                    { id: '16:9', icon: Monitor, label: 'Landscape' },
                  ].map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setAdOptions(prev => ({ ...prev, aspectRatio: r.id }))}
                      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all ${
                        adOptions.aspectRatio === r.id 
                          ? 'bg-[#ffcc29]/10 border-[#ffcc29] text-[#ffcc29]' 
                          : `${isDarkMode ? 'bg-slate-800/50 border-white/5 text-slate-400' : 'bg-white border-slate-200 text-slate-600'} hover:border-slate-400`
                      }`}
                    >
                      <r.icon className={`w-5 h-5 ${r.id === '16:9' ? 'rotate-90' : ''}`} />
                      <span className="text-[10px] font-black">{r.id}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-auto pt-8">
                <button
                  onClick={handleGenerateAd}
                  disabled={isGeneratingAd}
                  className="w-full h-14 bg-[#ffcc29] text-slate-900 rounded-2xl font-black text-sm shadow-xl shadow-[#ffcc29]/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                >
                  {isGeneratingAd ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      GENERATING...
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-5 h-5" />
                      GENERATE AD CREATIVE
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Modal Right Side - Preview */}
            <div className={`flex-1 p-8 md:p-12 flex flex-col items-center justify-center relative ${isDarkMode ? 'bg-slate-950/30' : 'bg-slate-100/50'}`}>
              <button 
                onClick={() => setShowAdModal(false)}
                className={`hidden md:block absolute top-8 right-8 p-3 rounded-2xl transition-all ${isDarkMode ? 'hover:bg-white/10 text-slate-400' : 'hover:bg-black/5 text-slate-500'}`}
              >
                <X className="w-6 h-6" />
              </button>

              <div className="w-full h-full flex flex-col items-center justify-center max-w-xl mx-auto">
                <div className={`relative w-full aspect-square rounded-[32px] overflow-hidden shadow-2xl border ${isDarkMode ? 'border-white/10 bg-black/40' : 'border-slate-300 bg-white'}`}>
                  {isGeneratingAd ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
                      <div className="relative">
                        <div className="w-20 h-20 border-4 border-[#ffcc29]/20 border-t-[#ffcc29] rounded-full animate-spin" />
                        <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-[#ffcc29] animate-pulse" />
                      </div>
                      <div className="text-center">
                        <p className={`text-sm font-black mb-1 ${theme.text}`}>Nano Banana 2 is working</p>
                        <p className={`text-xs font-medium ${theme.textSecondary}`}>Crafting your premium ad creative...</p>
                      </div>
                    </div>
                  ) : generatedAdUrl ? (
                    <img 
                      src={generatedAdUrl} 
                      alt="Generated AI Ad" 
                      className="w-full h-full object-contain animate-in fade-in zoom-in duration-700" 
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-12">
                      <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                        <ImagePlus className={`w-10 h-10 ${theme.textMuted}`} />
                      </div>
                      <h4 className={`text-xl font-black mb-3 ${theme.text}`}>Ready to Launch?</h4>
                      <p className={`text-xs leading-relaxed max-w-xs ${theme.textSecondary}`}>
                        Click generate to create an agency-grade marketing image for <span className="font-bold text-[#ffcc29]">{selectedAdProduct.name}</span>.
                      </p>
                    </div>
                  )}
                </div>

                {generatedAdUrl && !isGeneratingAd && (
                  <div className="mt-8 flex gap-4 w-full">
                    <button
                      onClick={() => downloadImage(generatedAdUrl, `${selectedAdProduct.name.replace(/\s+/g, '_')}_ad.png`)}
                      className="flex-1 h-16 bg-white text-slate-900 border border-slate-200 rounded-[20px] font-black text-sm hover:bg-slate-100 transition-all flex items-center justify-center gap-3 shadow-lg"
                    >
                      <DownloadCloud className="w-5 h-5" />
                      DOWNLOAD AD
                    </button>
                    <button
                      onClick={() => window.open(generatedAdUrl, '_blank')}
                      className={`flex-1 h-16 rounded-[20px] font-black text-sm transition-all flex items-center justify-center gap-3 border shadow-lg ${
                        isDarkMode ? 'bg-slate-800 border-white/5 hover:bg-slate-700 text-white' : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-800'
                      }`}
                    >
                      <ExternalLink className="w-5 h-5" />
                      VIEW FULLSIZE
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;
