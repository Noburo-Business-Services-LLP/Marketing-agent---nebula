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
import { GravityHero, GravityEmphasis } from '../components/gravity';

const Inventory: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
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

  // Form State. `keyFeatures` is newline-separated text in the form and split
  // into an array on save; `images` holds additional images beyond imageUrl.
  const [formData, setFormData] = useState({
    name: '',
    type: 'product' as 'product' | 'service',
    description: '',
    price: '',
    priceNote: '',
    currency: 'USD',
    imageUrl: '',
    images: [] as string[],
    keyFeatures: '',
    category: '',
    tags: ''
  });

  // ── Product images ──────────────────────────────────────────────────────
  // imageUrl is the primary image and `images` holds the rest. They are kept
  // separate in the model so existing consumers (Reels picker, campaign
  // generation) keep reading imageUrl, but the form treats them as one list.
  const productImagesInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageUploadError, setImageUploadError] = useState('');

  const allFormImages = [formData.imageUrl, ...formData.images].filter(Boolean);

  const setImageList = (list: string[]) => {
    setFormData(prev => ({ ...prev, imageUrl: list[0] || '', images: list.slice(1) }));
  };

  const removeImageAt = (index: number) => {
    setImageList(allFormImages.filter((_, i) => i !== index));
  };

  const makePrimaryImage = (index: number) => {
    const next = [...allFormImages];
    const [picked] = next.splice(index, 1);
    setImageList([picked, ...next]);
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });

  const handleImageFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setImageUploadError('');
    setUploadingImages(true);
    const uploaded: string[] = [];
    try {
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          setImageUploadError(`${file.name} is not an image`);
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          setImageUploadError(`${file.name} is larger than 10MB`);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        const res = await inventoryAPI.uploadProductImage(dataUrl);
        if (res?.success && res.url) {
          uploaded.push(res.url);
        } else {
          setImageUploadError(res?.message || `Could not upload ${file.name}`);
        }
      }
      if (uploaded.length) setImageList([...allFormImages, ...uploaded]);
    } catch (err: any) {
      setImageUploadError(err?.message || 'Image upload failed');
    } finally {
      setUploadingImages(false);
    }
  };

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
      type: 'product',
      description: '',
      price: '',
      priceNote: '',
      currency: 'USD',
      imageUrl: '',
      images: [],
      keyFeatures: '',
      category: '',
      tags: ''
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      type: product.type === 'service' ? 'service' : 'product',
      description: product.description || '',
      // price is optional now. `.toString()` on it threw for any entry without
      // one, and tsc cannot catch it here because strictNullChecks is off.
      price: product.price === undefined || product.price === null ? '' : String(product.price),
      priceNote: product.priceNote || '',
      currency: product.currency || 'USD',
      imageUrl: product.imageUrl || '',
      images: Array.isArray(product.images) ? product.images : [],
      keyFeatures: (product.keyFeatures || []).join('\n'),
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
      // Blank stays blank rather than becoming NaN — services may have no price.
      price: formData.price.trim() === '' ? undefined : parseFloat(formData.price),
      keyFeatures: formData.keyFeatures.split('\n').map(f => f.trim()).filter(Boolean),
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

  const inputClasses = `w-full px-4 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-[#F5A623] transition-all ${
    isDarkMode ? 'bg-slate-900 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900'
  }`;

  const labelClasses = `block text-xs font-bold uppercase tracking-wide mb-2 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`;

  return (
    <div className={embedded ? '' : 'p-6 min-h-screen'}>
      {/* Header. When embedded as a Brand Assets tab the page already has a
          hero, so this one is suppressed rather than stacking two. */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        {embedded ? (
          <div>
            <h2 className="font-serif-display text-[22px] text-[#F5F4F1]">Products &amp; Services</h2>
            <p className="text-[12.5px] text-white/45 mt-1 max-w-[560px]">
              What the business offers, with images and details Gravity draws on when it creates campaigns.
            </p>
          </div>
        ) : (
          <GravityHero
            align="left"
            eyebrow="Products & Services"
            headline={<>Everything you <GravityEmphasis>offer</GravityEmphasis></>}
            subcopy="Your products and services, with images and details Gravity draws on when it creates campaigns, images and videos."
            className="!mb-0"
          />
        )}
        
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
                ? 'bg-slate-800 border-slate-700 text-slate-200 hover:border-[#F5A623]/50 hover:text-[#F5A623]'
                : 'bg-white border-slate-200 text-slate-700 hover:border-[#F5A623] hover:text-[#F5A623]'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Import CSV / Excel
          </button>

          <button 
            onClick={handleOpenAdd}
            className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-[#F5A623] to-[#ffb833] text-black font-bold rounded-xl shadow-lg shadow-[#F5A623]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <Plus className="w-5 h-5" />
            Add Entry
          </button>
        </div>
      </div>

      {/* Stats Quick View */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          // Counts that describe a catalogue, not a stock ledger. "With images"
          // earns its place: an entry without images gives generation nothing
          // to work from, so it is the number worth acting on.
          { label: 'Total Entries', value: products.length, icon: Box, color: 'text-[#F5A623]', tint: 'bg-[#F5A623]/10 border-[#F5A623]/20' },
          { label: 'Products', value: products.filter(p => p.type !== 'service').length, icon: Package, color: 'text-[#F5A623]', tint: 'bg-[#F5A623]/10 border-[#F5A623]/20' },
          { label: 'Services', value: products.filter(p => p.type === 'service').length, icon: Sparkles, color: 'text-sky-300', tint: 'bg-sky-400/10 border-sky-400/20' },
          { label: 'With Images', value: products.filter(p => (p.imageUrl && p.imageUrl.trim()) || (p.images && p.images.length)).length, icon: ImageIcon, color: 'text-emerald-400', tint: 'bg-emerald-500/10 border-emerald-500/20' },
        ].map((stat, i) => (
          <div key={i} className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="gravity-label">{stat.label}</div>
              <p className="mt-1.5 text-[26px] font-serif-display leading-none text-[#F5F4F1]">{stat.value}</p>
            </div>
            <div className={`p-2.5 rounded-lg border flex-shrink-0 ${stat.tint}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className={`mb-6 p-4 rounded-2xl border shadow-sm flex flex-col md:flex-row items-center gap-4 border-white/[0.06] bg-white/[0.02]`}>
        <div className="relative flex-1 w-full">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
          <input 
            type="text" 
            placeholder="Search products and services..."
            className={`w-full pl-10 pr-4 py-2 text-sm rounded-xl outline-none border transition-all ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-white focus:border-[#F5A623]' : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-[#F5A623]'
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
            <div className="w-16 h-16 rounded-full border-4 border-slate-700 border-t-[#F5A623] animate-spin" />
            <Package className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-[#F5A623]" />
          </div>
          <p className={`text-sm font-medium animate-pulse ${theme.textSecondary}`}>Syncing your inventory...</p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className={`p-20 text-center rounded-3xl border border-dashed ${isDarkMode ? 'border-slate-800 bg-slate-900/20' : 'border-slate-200 bg-white'}`}>
          <div className="inline-flex p-6 rounded-full bg-slate-100 dark:bg-slate-800 mb-6">
            <Package className="w-12 h-12 text-slate-400" />
          </div>
          <h2 className={`text-xl font-bold ${theme.text}`}>Nothing here yet</h2>
          <p className={`text-sm mt-2 max-w-sm mx-auto ${theme.textSecondary}`}>
            Add a product or service so Gravity has real images and details to build campaigns from.
          </p>
          <button 
            onClick={handleOpenAdd}
            className="mt-6 px-6 py-3 bg-[#F5A623] text-black font-bold rounded-xl hover:bg-[#F5A623]/90 transition-all active:scale-95"
          >
            Add your first entry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProducts.map(product => (
            <div 
              key={product._id} 
              className={`group rounded-2xl border shadow-sm overflow-hidden transition-all duration-300 hover:shadow-xl hover:translate-y-[-4px] ${theme.bgCard} ${isDarkMode ? 'border-slate-800/50 hover:border-[#F5A623]/30' : 'border-slate-200/50 hover:border-[#F5A623]/30'}`}
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
                
                {/* No stock badge: this is a catalogue of what a business
                    offers, and Nebulaa has no way to know real stock levels.
                    Missing images matter here instead — an entry without one
                    gives generation nothing to work from. */}
                {!(product.imageUrl && product.imageUrl.trim()) && !(product.images && product.images.length) && (
                  <div className="absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em] border border-amber-400/25 bg-amber-400/10 text-amber-300 backdrop-blur-md">
                    No image
                  </div>
                )}

                {/* Quick Actions Overlay */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button 
                    onClick={() => handleOpenAdGenerator(product)}
                    className="p-3 bg-[#F5A623] rounded-xl text-slate-900 hover:bg-white transition-colors shadow-lg group/btn"
                    title="Generate AI Ad Image"
                  >
                    <Sparkles className="w-5 h-5 group-hover/btn:animate-pulse" />
                  </button>
                  <button 
                    onClick={() => handleOpenEdit(product)}
                    className="p-3 bg-white rounded-xl text-slate-800 hover:bg-[#F5A623] transition-colors shadow-lg"
                    title="Edit"
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
                    <span key={i} className={`px-2 py-1 rounded-lg text-[10px] font-bold ${isDarkMode ? 'bg-slate-800 text-[#F5A623]/70' : 'bg-slate-100 text-[#F5A623]'}`}>
                      #{tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-end justify-between gap-3 pt-4 border-t border-white/[0.06]">
                  <div className="min-w-0">
                    <div className="gravity-label">Pricing</div>
                    {product.price !== undefined && product.price !== null ? (
                      <p className="text-[18px] font-semibold text-[#F5A623] mt-0.5">
                        <span className="text-[11px] font-medium mr-0.5">{product.currency || 'USD'}</span>
                        {product.price}
                      </p>
                    ) : product.priceNote ? (
                      <p className="text-[13px] font-medium text-[#F5A623] mt-0.5 truncate">{product.priceNote}</p>
                    ) : (
                      <p className="text-[13px] text-white/35 mt-0.5">Not set</p>
                    )}
                    {product.price !== undefined && product.price !== null && product.priceNote && (
                      <p className="text-[11px] text-white/40 truncate">{product.priceNote}</p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-[0.12em] border ${
                    product.type === 'service'
                      ? 'border-sky-400/25 bg-sky-400/10 text-sky-300'
                      : 'border-[#F5A623]/25 bg-[#F5A623]/10 text-[#F5A623]'
                  }`}>
                    {product.type === 'service' ? 'Service' : 'Product'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          {/* gravity-glow sits on a wrapper, not the panel: the panel needs
              overflow-hidden for its rounded header, which would clip the
              glow's ::before at inset -14px. */}
          <div className="gravity-glow w-full max-w-2xl rounded-3xl animate-in slide-in-from-bottom-4 duration-500">
          <div className="relative w-full rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] bg-[#111111] border border-white/[0.08]">
            {/* Modal Header */}
            <div className={`px-8 py-6 border-b flex items-center justify-between ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20">
                  {editingProduct ? <Edit className="w-6 h-6 text-[#F5A623]" /> : <Plus className="w-6 h-6 text-[#F5A623]" />}
                </div>
                <div>
                  <h3 className={`text-xl font-black ${theme.text}`}>{editingProduct ? 'Edit Entry' : (formData.type === 'service' ? 'Add New Service' : 'Add New Product')}</h3>
                  <p className={`text-xs font-medium ${theme.textSecondary}`}>Details Gravity will draw on when generating campaigns.</p>
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
                {/* Type first: it changes what the rest of the form means. */}
                <div className="md:col-span-2">
                  <label className={labelClasses}>Type</label>
                  <div className="flex gap-2">
                    {(['product', 'service'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFormData({ ...formData, type: t })}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold capitalize transition-all border ${
                          formData.type === t
                            ? 'bg-[#F5A623] text-[#1A1208] border-[#F5A623] shadow-[0_4px_18px_rgba(245,166,35,0.20)]'
                            : 'border-white/[0.12] text-[#F5F4F1] hover:bg-white/[0.05] hover:border-white/20'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className={labelClasses}>{formData.type === 'service' ? 'Service Name *' : 'Product Name *'}</label>
                  <input
                    required
                    className={inputClasses}
                    placeholder={formData.type === 'service' ? 'e.g. Bridal Makeup Session' : 'e.g. Ultra Wireless Headphones'}
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                
                <div className="md:col-span-2">
                  <label className={labelClasses}>Description</label>
                  <textarea 
                    className={`${inputClasses} resize-none`} 
                    rows={3}
                    placeholder={formData.type === 'service' ? 'What the service involves, who it is for, what the outcome is...' : 'Provide a detailed description of the product...'}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                  />
                </div>

                {/* Concrete selling points. Generation uses these as copy source
                    material, so one per line keeps them individually usable. */}
                <div className="md:col-span-2">
                  <label className={labelClasses}>Key Features / Benefits</label>
                  <textarea
                    className={`${inputClasses} resize-none`}
                    rows={3}
                    placeholder={'One per line, e.g.\nHandmade in small batches\nDelivered within 48 hours'}
                    value={formData.keyFeatures}
                    onChange={(e) => setFormData({...formData, keyFeatures: e.target.value})}
                  />
                </div>
                
                <div>
                  <label className={labelClasses}>Price</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      className={`${inputClasses} pl-8`}
                      placeholder="Optional"
                      value={formData.price}
                      onChange={(e) => setFormData({...formData, price: e.target.value})}
                    />
                  </div>
                </div>

                {/* Replaces "Initial Stock". Stock is not something Nebulaa can
                    know; a flexible pricing line is something a service needs. */}
                <div>
                  <label className={labelClasses}>Pricing Note</label>
                  <input
                    className={inputClasses}
                    placeholder="e.g. From ₹5,000/session, Quote on request"
                    value={formData.priceNote}
                    onChange={(e) => setFormData({...formData, priceNote: e.target.value})}
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
                
                {/* Images. The first one is the primary and is stored as
                    `imageUrl`, so every existing consumer keeps working; the
                    rest go to `images`. */}
                <div className="md:col-span-2">
                  <label className={labelClasses}>Images</label>
                  <p className="text-[11.5px] text-white/40 -mt-1 mb-3">
                    The first image is the primary one. More angles and contexts give generation more to work with.
                  </p>

                  <div className="flex flex-wrap gap-3 mb-3">
                    {allFormImages.map((src, i) => (
                      <div key={`${src}-${i}`} className="relative group w-24 h-24 rounded-xl overflow-hidden border border-white/[0.10]">
                        <img src={src} className="w-full h-full object-cover" alt={`Image ${i + 1}`} />
                        {i === 0 && (
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-[0.1em] bg-[#F5A623] text-[#1A1208]">
                            Primary
                          </span>
                        )}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                          {i !== 0 && (
                            <button type="button" title="Make primary" onClick={() => makePrimaryImage(i)}
                              className="p-1.5 rounded-md bg-white/15 hover:bg-[#F5A623] hover:text-[#1A1208] text-white transition-colors">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button type="button" title="Remove" onClick={() => removeImageAt(i)}
                            className="p-1.5 rounded-md bg-white/15 hover:bg-red-500 text-white transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => productImagesInputRef.current?.click()}
                      disabled={uploadingImages}
                      className="w-24 h-24 rounded-xl border border-dashed border-white/[0.15] hover:border-[#F5A623]/50 hover:bg-white/[0.03] flex flex-col items-center justify-center gap-1 text-white/40 hover:text-[#F5A623] transition-all disabled:opacity-50"
                    >
                      {uploadingImages ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                      <span className="text-[10px] font-semibold">{uploadingImages ? 'Uploading' : 'Upload'}</span>
                    </button>
                    <input
                      ref={productImagesInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => { handleImageFiles(e.target.files); e.target.value = ''; }}
                    />
                  </div>

                  {imageUploadError && (
                    <p className="text-[12px] text-red-300 mb-3">{imageUploadError}</p>
                  )}

                  <details className="group">
                    <summary className="cursor-pointer text-[11.5px] text-white/40 hover:text-white/70 select-none">
                      Or paste an image URL
                    </summary>
                    <input
                      className={`${inputClasses} mt-2`}
                      placeholder="https://..."
                      value={formData.imageUrl.startsWith('data:') ? '' : formData.imageUrl}
                      onChange={(e) => setFormData({...formData, imageUrl: e.target.value})}
                    />
                    <p className="text-[11px] text-white/35 mt-1.5">
                      Fetched fresh each time something is generated. If the link is slow, private or dead, the image is skipped silently — uploading is more reliable.
                    </p>
                  </details>
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
                  className="px-8 py-3 bg-gradient-to-r from-[#F5A623] to-[#ffb833] text-black font-black rounded-xl shadow-lg shadow-[#F5A623]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : editingProduct ? 'Save Changes' : (formData.type === 'service' ? 'Create Service' : 'Create Product')}
                </button>
              </div>
            </form>
          </div>
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
                <div className="p-3 rounded-2xl bg-[#F5A623]/10 border border-[#F5A623]/20">
                  <Upload className="w-5 h-5 text-[#F5A623]" />
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
                      ? 'border-[#F5A623] bg-[#F5A623]/5 scale-[1.01]'
                      : importFile
                      ? isDarkMode ? 'border-green-500/40 bg-green-500/5' : 'border-green-400 bg-green-50'
                      : isDarkMode ? 'border-slate-700 hover:border-[#F5A623]/50 hover:bg-[#F5A623]/5' : 'border-slate-200 hover:border-[#F5A623] hover:bg-[#F5A623]/5'
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
                        isDragging ? 'bg-[#F5A623]/10 border-[#F5A623]/30' : isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'
                      }`}>
                        <Upload className={`w-8 h-8 ${isDragging ? 'text-[#F5A623]' : isDarkMode ? 'text-slate-500' : 'text-slate-400'}`} />
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
                      isDarkMode ? 'border-slate-700 text-slate-400 hover:border-[#F5A623]/40 hover:text-[#F5A623]' : 'border-slate-200 text-slate-500 hover:border-[#F5A623] hover:text-[#F5A623]'
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
                  className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-[#F5A623] to-[#ffb833] text-black font-black text-sm rounded-xl shadow-lg shadow-[#F5A623]/20 hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
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
                  className="px-6 py-2.5 bg-gradient-to-r from-[#F5A623] to-[#ffb833] text-black font-black text-sm rounded-xl shadow-lg shadow-[#F5A623]/20 hover:shadow-xl transition-all"
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
                  <div className="p-2.5 rounded-2xl bg-[#F5A623]/20 border border-[#F5A623]/30">
                    <Sparkles className="w-6 h-6 text-[#F5A623]" />
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
                          ? 'bg-[#F5A623]/10 border-[#F5A623] text-[#F5A623]' 
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
                          ? 'bg-[#F5A623]/10 border-[#F5A623] text-[#F5A623]' 
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
                          ? 'bg-[#F5A623]/10 border-[#F5A623] text-[#F5A623]' 
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
                  className="w-full h-14 bg-[#F5A623] text-slate-900 rounded-2xl font-black text-sm shadow-xl shadow-[#F5A623]/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
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
                        <div className="w-20 h-20 border-4 border-[#F5A623]/20 border-t-[#F5A623] rounded-full animate-spin" />
                        <Sparkles className="absolute inset-0 m-auto w-8 h-8 text-[#F5A623] animate-pulse" />
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
                        Click generate to create an agency-grade marketing image for <span className="font-bold text-[#F5A623]">{selectedAdProduct.name}</span>.
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
