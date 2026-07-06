import React, { useState, useEffect } from 'react';
import { FileText, Search, Trash2, Calendar, Loader2, Plus, ExternalLink, RefreshCw, AlertCircle, Instagram, Facebook, Linkedin, Twitter } from 'lucide-react';
import { Draft } from '../types';
import { draftsAPI } from '../services/api';
import { DraftPreviewModal } from '../components/DraftPreviewModal';
import { Link, useNavigate } from 'react-router-dom';

export const Drafts: React.FC = () => {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filteredDrafts, setFilteredDrafts] = useState<Draft[]>([]);
  
  // Filters & Search
  const [activeTab, setActiveTab] = useState<'all' | 'draft' | 'scheduled' | 'published' | 'archived'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Loading & Error States
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Selected draft for editing/preview
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);

  // Bulk schedule modal/inputs
  const [showBulkScheduler, setShowBulkScheduler] = useState(false);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkTime, setBulkTime] = useState('');
  const [isBulkScheduling, setIsBulkScheduling] = useState(false);

  const fetchDrafts = async () => {
    setIsLoading(true);
    setError('');
    try {
      // Query drafts by selected status
      const response = await draftsAPI.getDrafts(activeTab);
      setDrafts(response.drafts || []);
      setSelectedIds([]); // Reset selection on reload
    } catch (err: any) {
      setError(err.message || 'Failed to load drafts.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, [activeTab]);

  // Polling for processing drafts
  useEffect(() => {
    const hasProcessing = drafts.some(d => d.status === 'processing');
    let interval: any;
    
    if (hasProcessing) {
      interval = setInterval(async () => {
        try {
          const response = await draftsAPI.getDrafts(activeTab);
          if (response.drafts) {
            setDrafts(response.drafts);
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 4000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [drafts, activeTab]);

  // Apply search filtering locally
  useEffect(() => {
    let result = drafts;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => 
        (d.title && d.title.toLowerCase().includes(q)) || 
        (d.caption && d.caption.toLowerCase().includes(q))
      );
    }
    setFilteredDrafts(result);
  }, [drafts, searchQuery]);

  const handleSelectDraft = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredDrafts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredDrafts.map(d => d._id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to archive the ${selectedIds.length} selected draft(s)?`)) {
      setIsLoading(true);
      try {
        await Promise.all(selectedIds.map(id => draftsAPI.deleteDraft(id)));
        await fetchDrafts();
      } catch (err: any) {
        setError('Failed to delete some drafts.');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleBulkSchedule = async () => {
    if (selectedIds.length === 0 || !bulkDate || !bulkTime) return;
    setIsBulkScheduling(true);
    try {
      const scheduledDateTime = new Date(`${bulkDate}T${bulkTime}:00`).toISOString();
      await Promise.all(selectedIds.map(id => draftsAPI.scheduleDraft(id, scheduledDateTime)));
      setShowBulkScheduler(false);
      setBulkDate('');
      setBulkTime('');
      await fetchDrafts();
    } catch (err: any) {
      setError('Failed to schedule some drafts.');
    } finally {
      setIsBulkScheduling(false);
    }
  };

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    switch (p) {
      case 'instagram': return <Instagram className="w-4 h-4 text-pink-400" />;
      case 'facebook': return <Facebook className="w-4 h-4 text-blue-500" />;
      case 'linkedin': return <Linkedin className="w-4 h-4 text-blue-400" />;
      case 'twitter': return <Twitter className="w-4 h-4 text-sky-400" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: Draft['status']) => {
    switch (status) {
      case 'draft': 
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-300 border border-slate-700">Draft</span>;
      case 'scheduled': 
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-950/40 text-blue-400 border border-blue-900/50">Scheduled</span>;
      case 'published': 
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-green-950/40 text-green-400 border border-green-900/50">Published</span>;
      case 'archived': 
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-900 text-slate-500 border border-slate-800">Archived</span>;
      case 'processing':
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-indigo-950/40 text-indigo-400 border border-indigo-900/50 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> Processing</span>;
      case 'completed':
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-teal-950/40 text-teal-400 border border-teal-900/50">Completed</span>;
      case 'failed':
        return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-red-950/40 text-red-400 border border-red-900/50 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> Failed</span>;
      default: 
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[#070A12] text-slate-100 p-6 md:p-8 lg:p-12">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-100 flex items-center gap-2">
              <FileText className="w-8 h-8 text-[#ffcc29]" />
              Content Drafts & Library
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Auto-saved posts and campaigns. Preview, edit, schedule, or publish them anytime.
            </p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={fetchDrafts}
              className="p-3 bg-slate-850 hover:bg-slate-800 rounded-xl border border-slate-800 transition-all text-slate-300 hover:text-[#ffcc29]"
              title="Refresh Drafts"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <Link 
              to="/campaigns"
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#ffcc29] hover:bg-[#ebd038] text-black font-bold text-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Create Campaign
            </Link>
          </div>
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/60 pb-4">
          {/* Tab Filters */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'draft', 'scheduled', 'published', 'archived'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedIds([]);
                }}
                className={`px-4 py-2 text-xs uppercase font-bold rounded-lg tracking-wider border transition-all ${
                  activeTab === tab 
                    ? 'bg-[#ffcc29]/15 border-[#ffcc29] text-[#ffcc29]' 
                    : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {tab}s
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by title or caption..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-950/60 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#ffcc29]/40"
            />
          </div>
        </div>

        {/* Bulk Actions Panel */}
        {selectedIds.length > 0 && (
          <div className="p-4 bg-slate-950/80 border border-slate-850 rounded-xl flex flex-wrap items-center justify-between gap-4 transition-all">
            <span className="text-xs text-[#ffcc29] font-semibold">{selectedIds.length} draft(s) selected</span>
            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkScheduler(!showBulkScheduler)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-950/40 border border-blue-900 text-blue-400 hover:bg-blue-900/30 text-xs font-bold"
              >
                <Calendar className="w-3.5 h-3.5" />
                Bulk Schedule
              </button>
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-950/40 border border-red-900 text-red-400 hover:bg-red-900/30 text-xs font-bold"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Bulk Archive
              </button>
            </div>
          </div>
        )}

        {/* Bulk Scheduler Form */}
        {showBulkScheduler && (
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-3 gap-4 items-end max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Date</label>
              <input 
                type="date"
                value={bulkDate}
                onChange={(e) => setBulkDate(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-850 rounded-lg text-slate-200 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">Time</label>
              <input 
                type="time"
                value={bulkTime}
                onChange={(e) => setBulkTime(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-850 rounded-lg text-slate-200 focus:outline-none"
              />
            </div>
            <button
              onClick={handleBulkSchedule}
              disabled={isBulkScheduling || !bulkDate || !bulkTime}
              className="px-4 py-2 bg-[#ffcc29] hover:bg-[#ebd038] text-black font-bold text-xs rounded-lg flex items-center justify-center disabled:opacity-50 h-9"
            >
              {isBulkScheduling ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Bulk Schedule'}
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 text-red-400 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Error Occurred</h4>
              <p className="text-xs text-red-300 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Main Grid View */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-[#ffcc29] mb-4" />
            <p className="text-slate-400 text-sm">Fetching draft database...</p>
          </div>
        ) : filteredDrafts.length === 0 ? (
          /* Empty State */
          <div className="border border-dashed border-slate-800 rounded-3xl p-16 text-center max-w-xl mx-auto flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-[#ffcc29]/10 flex items-center justify-center mb-6">
              <FileText className="w-8 h-8 text-[#ffcc29]" />
            </div>
            <h3 className="text-lg font-bold text-slate-200">No Drafts Found</h3>
            <p className="text-slate-400 text-sm mt-2 max-w-md">
              Drafts are generated automatically when creating posts or campaigns. Anything you write or suggest will be saved here so you never lose your progress.
            </p>
            <Link 
              to="/campaigns"
              className="mt-6 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-850 text-[#ffcc29] border border-slate-800 text-xs font-bold transition-all"
            >
              Start Generating Content
            </Link>
          </div>
        ) : (
          /* Draft Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Header select checkbox */}
            <div className="col-span-full flex items-center justify-between px-2">
              <button 
                onClick={handleSelectAll} 
                className="text-xs text-[#ffcc29] hover:underline"
              >
                {selectedIds.length === filteredDrafts.length ? 'Deselect All' : 'Select All on Page'}
              </button>
              <span className="text-xs text-slate-500">{filteredDrafts.length} drafts loaded</span>
            </div>

            {filteredDrafts.map((item) => {
              const selected = selectedIds.includes(item._id);
              return (
                <div 
                  key={item._id}
                  className={`group relative bg-slate-950/40 border rounded-2xl overflow-hidden transition-all flex flex-col hover:border-slate-700/80 hover:shadow-xl ${
                    selected ? 'border-[#ffcc29]' : 'border-slate-850'
                  }`}
                >
                  {/* Select Checkbox (top-left overlay) */}
                  <div className="absolute top-4 left-4 z-10">
                    <input 
                      type="checkbox"
                      checked={selected}
                      onChange={() => handleSelectDraft(item._id)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-[#ffcc29] focus:ring-[#ffcc29] cursor-pointer"
                    />
                  </div>

                  {/* Thumbnail / Image Preview */}
                  <div className="relative aspect-video w-full bg-slate-900 overflow-hidden flex items-center justify-center">
                    {item.status === 'processing' ? (
                      <div className="absolute inset-0 bg-slate-800 animate-pulse flex flex-col items-center justify-center space-y-3 p-4">
                        <Loader2 className="w-8 h-8 text-[#ffcc29] animate-spin" />
                        <span className="text-xs text-[#ffcc29] font-medium text-center line-clamp-2">
                          {item.generationProgress?.step || 'Processing...'}
                        </span>
                        {typeof item.generationProgress?.progress === 'number' && item.generationProgress.progress > 0 && (
                          <div className="w-2/3 bg-slate-700 rounded-full h-1.5 mt-2 overflow-hidden">
                            <div className="bg-[#ffcc29] h-1.5 rounded-full transition-all duration-300" style={{ width: `${item.generationProgress.progress}%` }}></div>
                          </div>
                        )}
                      </div>
                    ) : item.status === 'failed' ? (
                      <div className="absolute inset-0 bg-red-950/30 flex flex-col items-center justify-center text-red-500 p-4">
                        <AlertCircle className="w-8 h-8 mb-2 opacity-80" />
                        <span className="text-xs font-semibold text-center line-clamp-2">
                          {item.errorMessage || 'Generation Failed'}
                        </span>
                      </div>
                    ) : item.imageUrl ? (
                      <img 
                        src={item.imageUrl} 
                        alt={item.title} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="text-3xl text-slate-700">🖼️</div>
                    )}
                    
                    {/* Status Overlay */}
                    <div className="absolute top-4 right-4">
                      {getStatusBadge(item.status)}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-slate-200 line-clamp-1 group-hover:text-slate-100 transition-colors">
                          {item.title || 'Untitled Post'}
                        </h3>
                        <span className="text-[9px] uppercase font-bold text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded flex-shrink-0">
                          {item.sourceType}
                        </span>
                      </div>
                      {item.calendarWeek && (
                        <div className="text-[10px] text-indigo-400 bg-indigo-950/40 border border-indigo-900/50 px-1.5 py-0.5 rounded mt-1.5 inline-block font-medium">
                          Calendar: Week {item.calendarWeek}, Day {item.calendarDay}
                        </div>
                      )}
                      
                      <p className="text-xs text-slate-400 line-clamp-3 mt-2 font-light leading-relaxed">
                        {item.caption || <span className="italic text-slate-600">No caption defined</span>}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-900/60 flex items-center justify-between">
                      {/* Platforms */}
                      <div className="flex gap-1.5">
                        {item.platforms && item.platforms.length > 0 ? (
                          item.platforms.map(p => (
                            <span key={p} title={p} className="p-1 bg-slate-900/80 rounded-md">
                              {getPlatformIcon(p) || <span className="text-[10px] text-slate-400 capitalize">{p.charAt(0)}</span>}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-600">No platform</span>
                        )}
                      </div>

                      {/* Info / Action Buttons */}
                      <div className="flex items-center gap-3">
                        {item.hashtags && item.hashtags.length > 0 && (
                          <span className="text-[10px] text-[#ffcc29] bg-[#ffcc29]/5 border border-[#ffcc29]/15 px-1.5 py-0.5 rounded">
                            {item.hashtags.length} Tags
                          </span>
                        )}
                        {item.status === 'processing' ? (
                          <span className="text-xs font-bold text-slate-500 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" /> Generating
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              if (String(item.sourceType).toLowerCase() === 'reel' || String(item.contentType).toLowerCase() === 'reel') {
                                const jobId = item.generationProgress?.jobId || item._id;
                                navigate(`/reels?jobId=${jobId}`);
                              } else {
                                setSelectedDraft(item);
                              }
                            }}
                            className="text-xs font-bold text-[#ffcc29] hover:underline flex items-center gap-1"
                          >
                            {item.status === 'failed' ? 'View/Retry' : 'Edit & Post'}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal Overlay for Editor */}
        {selectedDraft && (
          <DraftPreviewModal
            draft={selectedDraft}
            onClose={() => setSelectedDraft(null)}
            onSuccess={() => {
              setSelectedDraft(null);
              fetchDrafts();
            }}
          />
        )}

      </div>
    </div>
  );
};
