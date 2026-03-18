import React, { useState, useEffect } from 'react';
import { ImageIcon, X, Loader2, ChevronDown } from 'lucide-react';
import { brandAssetsAPI } from '../services/api';

interface BrandLogo {
  _id: string;
  name: string;
  url: string;
  isPrimary: boolean;
}

interface LogoSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (logoUrl: string | null) => void;
  title?: string;
  subtitle?: string;
}

const LogoSelector: React.FC<LogoSelectorProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Add Brand Logo?',
  subtitle = 'Select a logo to include in the generated image'
}) => {
  const [logos, setLogos] = useState<BrandLogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const isDarkMode = document.documentElement.classList.contains('dark');

  useEffect(() => {
    if (isOpen) {
      fetchLogos();
    }
  }, [isOpen]);

  const fetchLogos = async () => {
    try {
      setLoading(true);
      const res = await brandAssetsAPI.getLogos();
      if (res.success && res.logos?.length > 0) {
        setLogos(res.logos);
        // Auto-select primary logo
        const primary = res.logos.find((l: BrandLogo) => l.isPrimary);
        if (primary) setSelectedLogo(primary.url);
      } else {
        setLogos([]);
      }
    } catch (err) {
      console.error('Failed to fetch logos:', err);
      setLogos([]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl ${
        isDarkMode ? 'bg-[#0d1117] border border-slate-700/50' : 'bg-white'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ffcc29]/20 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-[#ffcc29]" />
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {title}
              </h3>
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {subtitle}
              </p>
            </div>
          </div>
          <button onClick={onClose} className={`p-2 rounded-lg ${isDarkMode ? 'hover:bg-slate-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[#ffcc29]" />
            </div>
          ) : logos.length === 0 ? (
            <div className="text-center py-6">
              <ImageIcon className={`w-12 h-12 mx-auto mb-3 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'}`} />
              <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                No logos uploaded yet. Go to Brand Assets to upload one.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Logo Grid */}
              <div className="grid grid-cols-3 gap-3">
                {logos.map((logo) => (
                  <button
                    key={logo._id}
                    onClick={() => setSelectedLogo(selectedLogo === logo.url ? null : logo.url)}
                    className={`relative aspect-square rounded-xl border-2 p-3 flex items-center justify-center transition-all ${
                      selectedLogo === logo.url
                        ? 'border-[#ffcc29] bg-[#ffcc29]/10 scale-105'
                        : isDarkMode
                          ? 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <img src={logo.url} alt={logo.name} className="max-w-full max-h-full object-contain" />
                    {selectedLogo === logo.url && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ffcc29] rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-[#070A12]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {logo.isPrimary && (
                      <span className="absolute bottom-1 left-1 text-[8px] bg-[#ffcc29] text-[#070A12] px-1 rounded font-bold">
                        PRIMARY
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Selected info */}
              {selectedLogo && (
                <p className={`text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Logo will be integrated into the generated image
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center gap-3 p-5 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-100'}`}>
          <button
            onClick={() => onConfirm(null)}
            className={`flex-1 py-2.5 rounded-xl font-medium transition-colors ${
              isDarkMode
                ? 'bg-slate-800 text-gray-300 hover:bg-slate-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Skip — No Logo
          </button>
          <button
            onClick={() => onConfirm(selectedLogo)}
            disabled={!selectedLogo}
            className="flex-1 py-2.5 rounded-xl font-semibold bg-[#ffcc29] text-[#070A12] hover:bg-[#e6b825] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Use Logo
          </button>
        </div>
      </div>
    </div>
  );
};

export default LogoSelector;
