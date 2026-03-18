import React, { useState } from 'react';
import { X, Heart, MessageCircle, Send, Bookmark, Share2, ThumbsUp, Repeat2, MoreHorizontal, Globe, ChevronDown } from 'lucide-react';

interface PlatformPreviewProps {
  platform?: string;
  imageUrl?: string | null;
  caption?: string;
  hashtags?: string[] | string;
  brandName?: string;
  onClose: () => void;
  isDarkMode?: boolean;
}

const PlatformPreview: React.FC<PlatformPreviewProps> = ({
  platform = 'instagram',
  imageUrl,
  caption = '',
  hashtags = [],
  brandName = 'Your Brand',
  onClose,
  isDarkMode = false,
}) => {
  const [activeTab, setActiveTab] = useState(platform.toLowerCase());

  const hashtagStr = Array.isArray(hashtags)
    ? hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ')
    : hashtags || '';

  const fullCaption = caption + (hashtagStr ? `\n\n${hashtagStr}` : '');
  const initial = brandName.charAt(0).toUpperCase();
  const handle = `@${brandName.toLowerCase().replace(/\s+/g, '')}`;
  const timeAgo = 'Just now';

  const platforms = [
    { id: 'instagram', label: 'Instagram', color: 'from-pink-500 to-purple-600' },
    { id: 'facebook', label: 'Facebook', color: 'from-blue-500 to-blue-700' },
    { id: 'twitter', label: 'Twitter / X', color: 'from-sky-400 to-sky-600' },
    { id: 'linkedin', label: 'LinkedIn', color: 'from-blue-600 to-blue-800' },
  ];

  const renderInstagram = () => (
    <div className="bg-white rounded-lg overflow-hidden max-w-[380px] mx-auto shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 via-pink-500 to-purple-600 p-[2px]">
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center">
              <span className="text-xs font-bold text-gray-800">{initial}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-900">{brandName.toLowerCase().replace(/\s+/g, '')}</p>
            <p className="text-[10px] text-gray-500">Original</p>
          </div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-gray-800" />
      </div>

      {/* Image */}
      {imageUrl ? (
        <div className="aspect-square bg-gray-100">
          <img src={imageUrl} alt="Post" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          <p className="text-gray-400 text-sm">No image</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Heart className="w-5 h-5 text-gray-800 cursor-pointer hover:text-gray-500" />
            <MessageCircle className="w-5 h-5 text-gray-800 cursor-pointer hover:text-gray-500" />
            <Send className="w-5 h-5 text-gray-800 cursor-pointer hover:text-gray-500" />
          </div>
          <Bookmark className="w-5 h-5 text-gray-800 cursor-pointer hover:text-gray-500" />
        </div>
        <p className="text-xs font-semibold text-gray-900 mt-2">0 likes</p>
      </div>

      {/* Caption */}
      <div className="px-3 pb-3">
        <p className="text-xs text-gray-900 leading-relaxed">
          <span className="font-semibold">{brandName.toLowerCase().replace(/\s+/g, '')} </span>
          {fullCaption.length > 150 ? fullCaption.slice(0, 150) + '... more' : fullCaption}
        </p>
        <p className="text-[10px] text-gray-400 mt-1.5 uppercase">{timeAgo}</p>
      </div>
    </div>
  );

  const renderFacebook = () => (
    <div className="bg-white rounded-lg overflow-hidden max-w-[420px] mx-auto shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center">
          <span className="text-sm font-bold text-white">{initial}</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{brandName}</p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-gray-500">{timeAgo}</p>
            <span className="text-gray-400">·</span>
            <Globe className="w-3 h-3 text-gray-400" />
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-500" />
      </div>

      {/* Caption */}
      <div className="px-4 pb-3">
        <p className="text-sm text-gray-900 leading-relaxed whitespace-pre-wrap">
          {fullCaption.length > 250 ? fullCaption.slice(0, 250) + '... See more' : fullCaption}
        </p>
      </div>

      {/* Image */}
      {imageUrl ? (
        <div className="bg-gray-100">
          <img src={imageUrl} alt="Post" className="w-full object-cover max-h-[400px]" />
        </div>
      ) : (
        <div className="h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          <p className="text-gray-400 text-sm">No image</p>
        </div>
      )}

      {/* Reactions bar */}
      <div className="px-4 py-2 border-t border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-[8px] text-white">👍</span>
              <span className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[8px] text-white">❤️</span>
            </div>
            <span>0</span>
          </div>
          <span>0 comments · 0 shares</span>
        </div>
        <div className="flex items-center justify-around pt-1">
          <button className="flex items-center gap-1.5 px-4 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">
            <ThumbsUp className="w-4 h-4" /> Like
          </button>
          <button className="flex items-center gap-1.5 px-4 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">
            <MessageCircle className="w-4 h-4" /> Comment
          </button>
          <button className="flex items-center gap-1.5 px-4 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">
            <Share2 className="w-4 h-4" /> Share
          </button>
        </div>
      </div>
    </div>
  );

  const renderTwitter = () => (
    <div className="bg-white rounded-lg overflow-hidden max-w-[420px] mx-auto shadow-lg">
      <div className="px-4 py-3">
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-900 flex-shrink-0 flex items-center justify-center">
            <span className="text-sm font-bold text-white">{initial}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-sm font-bold text-gray-900 truncate">{brandName}</p>
              <svg className="w-4 h-4 text-blue-500 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"/></svg>
            </div>
            <p className="text-xs text-gray-500">{handle}</p>

            {/* Tweet content */}
            <p className="text-sm text-gray-900 mt-2 leading-relaxed whitespace-pre-wrap">
              {fullCaption.length > 280 ? (
                <>
                  {fullCaption.slice(0, 280)}
                  <span className="text-red-500 font-medium"> ({fullCaption.length}/280)</span>
                </>
              ) : fullCaption}
            </p>

            {/* Image */}
            {imageUrl && (
              <div className="mt-3 rounded-2xl overflow-hidden border border-gray-200">
                <img src={imageUrl} alt="Post" className="w-full object-cover max-h-[300px]" />
              </div>
            )}

            {/* Time */}
            <p className="text-xs text-gray-500 mt-3">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })} · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>

            {/* Engagement */}
            <div className="flex items-center gap-6 mt-2 pt-2 border-t border-gray-100">
              <span className="text-xs text-gray-500"><strong className="text-gray-900">0</strong> Reposts</span>
              <span className="text-xs text-gray-500"><strong className="text-gray-900">0</strong> Likes</span>
              <span className="text-xs text-gray-500"><strong className="text-gray-900">0</strong> Views</span>
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-gray-500">
              <MessageCircle className="w-4 h-4 hover:text-blue-500 cursor-pointer" />
              <Repeat2 className="w-4 h-4 hover:text-green-500 cursor-pointer" />
              <Heart className="w-4 h-4 hover:text-pink-500 cursor-pointer" />
              <Bookmark className="w-4 h-4 hover:text-blue-500 cursor-pointer" />
              <Share2 className="w-4 h-4 hover:text-blue-500 cursor-pointer" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLinkedIn = () => (
    <div className="bg-white rounded-lg overflow-hidden max-w-[420px] mx-auto shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
          <span className="text-lg font-bold text-white">{initial}</span>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{brandName}</p>
          <p className="text-xs text-gray-500">0 followers</p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-gray-500">{timeAgo}</p>
            <span className="text-gray-400">·</span>
            <Globe className="w-3 h-3 text-gray-400" />
          </div>
        </div>
        <MoreHorizontal className="w-5 h-5 text-gray-500" />
      </div>

      {/* Caption */}
      <div className="px-4 pb-3">
        <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
          {fullCaption.length > 300 ? fullCaption.slice(0, 300) + '... see more' : fullCaption}
        </p>
      </div>

      {/* Image */}
      {imageUrl ? (
        <div className="bg-gray-100">
          <img src={imageUrl} alt="Post" className="w-full object-cover max-h-[400px]" />
        </div>
      ) : (
        <div className="h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          <p className="text-gray-400 text-sm">No image</p>
        </div>
      )}

      {/* Reactions */}
      <div className="px-4 py-2">
        <div className="flex items-center justify-between text-xs text-gray-500 pb-2 border-b border-gray-200">
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              <span className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-[8px]">👍</span>
              <span className="w-4 h-4 rounded-full bg-red-400 flex items-center justify-center text-[8px]">❤️</span>
              <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-[8px]">👏</span>
            </div>
            <span>0</span>
          </div>
          <span>0 comments · 0 reposts</span>
        </div>
        <div className="flex items-center justify-around pt-1">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-xs font-medium">
            <ThumbsUp className="w-4 h-4" /> Like
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-xs font-medium">
            <MessageCircle className="w-4 h-4" /> Comment
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-xs font-medium">
            <Repeat2 className="w-4 h-4" /> Repost
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-xs font-medium">
            <Send className="w-4 h-4" /> Send
          </button>
        </div>
      </div>
    </div>
  );

  const renderPreview = () => {
    switch (activeTab) {
      case 'instagram': return renderInstagram();
      case 'facebook': return renderFacebook();
      case 'twitter': return renderTwitter();
      case 'linkedin': return renderLinkedIn();
      default: return renderInstagram();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className={`${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#f5f5f5] border-slate-200'} border rounded-2xl shadow-2xl max-w-[500px] w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`sticky top-0 z-10 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-[#f5f5f5] border-slate-200'} border-b px-5 py-3`}>
          <div className="flex items-center justify-between">
            <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Platform Preview</h3>
            <button onClick={onClose} className={`p-1.5 ${isDarkMode ? 'hover:bg-[#161b22]' : 'hover:bg-white'} rounded-lg transition-colors`}>
              <X className={`w-4 h-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`} />
            </button>
          </div>

          {/* Platform tabs */}
          <div className="flex items-center gap-1.5 mt-2.5">
            {platforms.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveTab(p.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                  activeTab === p.id
                    ? `bg-gradient-to-r ${p.color} text-white shadow-md`
                    : `${isDarkMode ? 'text-slate-400 hover:text-white hover:bg-[#161b22]' : 'text-gray-500 hover:text-gray-900 hover:bg-white'}`
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="p-5">
          {renderPreview()}
        </div>

        {/* Character count warning */}
        {activeTab === 'twitter' && fullCaption.length > 280 && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-xs text-red-600 font-medium">
                ⚠️ Caption exceeds Twitter's 280 character limit ({fullCaption.length}/280)
              </span>
            </div>
          </div>
        )}

        {/* Footer hint */}
        <div className={`px-5 pb-4 text-center`}>
          <p className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
            This is an approximate preview. Actual appearance may vary slightly.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PlatformPreview;
