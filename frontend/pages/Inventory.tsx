import React, { useState, useEffect } from 'react';
import { 
  Plus, Search, Edit, Trash2, Box, Package, 
  Filter, Download, ChevronRight, Loader2, 
  Image as ImageIcon, MoreVertical, AlertCircle,
  Tag, BarChart3, Clock, Check, X
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
        
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchProducts}
            className={`p-2.5 rounded-xl border transition-all hover:scale-105 active:scale-95 ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            <Clock className="w-5 h-5" />
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
    </div>
  );
};

export default Inventory;
