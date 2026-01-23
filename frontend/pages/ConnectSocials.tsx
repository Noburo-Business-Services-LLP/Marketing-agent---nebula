import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '../services/api';
import { SocialConnection } from '../types';
import { Loader2, RefreshCw, Check, X, Instagram, Facebook, Linkedin, Youtube, Video, AlertCircle, ShieldCheck, MessageCircle, Pin, ExternalLink } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

// X (Twitter) logo SVG component
const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const ConnectSocials: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const location = useLocation();
  const [socials, setSocials] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Connection State
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [showFakeAuthWindow, setShowFakeAuthWindow] = useState(false);
  const [authStep, setAuthStep] = useState(0); // 0: loading, 1: consent, 2: success
  const [usernameInput, setUsernameInput] = useState('');
  
  // Loading states per platform
  const [loadingPlatform, setLoadingPlatform] = useState<string | null>(null);

  useEffect(() => {
    loadSocials();
    
    // Check URL params for OAuth callback results
    const searchParams = new URLSearchParams(location.search);
    const error = searchParams.get('error');
    const account = searchParams.get('account');
    
    // Check for successful connections for each platform
    const platforms = ['instagram', 'facebook', 'x', 'linkedin'];
    for (const platform of platforms) {
      const status = searchParams.get(platform);
      if (status === 'connected') {
        const displayName = platform.charAt(0).toUpperCase() + platform.slice(1);
        setNotification({
          type: 'success',
          message: `${displayName}${account ? ` (${decodeURIComponent(account)})` : ''} connected successfully!`
        });
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => loadSocials(), 500);
        break;
      }
    }
    
    // Legacy YouTube callback
    const youtubeStatus = searchParams.get('youtube');
    const channelName = searchParams.get('channel');
    if (youtubeStatus === 'connected' && channelName) {
      setNotification({
        type: 'success',
        message: `YouTube channel "${decodeURIComponent(channelName)}" connected successfully!`
      });
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => loadSocials(), 500);
    } else if (error) {
      let errorMessage = 'Failed to connect account.';
      switch (error) {
        case 'access_denied':
          errorMessage = 'You denied access to your account.';
          break;
        case 'no_channel':
          errorMessage = 'No YouTube channel found for this Google account.';
          break;
        case 'token_exchange_failed':
          errorMessage = 'Failed to authenticate. Please try again.';
          break;
        case 'invalid_state':
          errorMessage = 'Authentication session expired. Please try again.';
          break;
      }
      setNotification({ type: 'error', message: errorMessage });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location.search]);

  // Auto-dismiss notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadSocials = async () => {
    try {
      const res = await apiService.getSocials();
      setSocials(res.connections || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const initiateConnection = async (platform: string) => {
    setLoadingPlatform(platform);
    setConnectingPlatform(platform);
    
    try {
      // Use universal OAuth endpoint for all platforms
      const response = await apiService.getPlatformAuthUrl(platform);
      
      if (response.success && response.authUrl) {
        // For Ayrshare JWT flow, open in a new tab/window as recommended by Ayrshare docs
        // This allows the Close button to work properly and return the user to our app
        if (response.method === 'ayrshare_jwt') {
          // Open Ayrshare social linking page in a new tab
          const newWindow = window.open(response.authUrl, '_blank', 'noopener,noreferrer');
          if (newWindow) {
            newWindow.focus();
          }
          // Reset loading state since user will return via redirect
          setLoadingPlatform(null);
          setConnectingPlatform(null);
          setNotification({
            type: 'success',
            message: `A new tab has opened. Connect your ${platform} account there and return here when done.`
          });
        } else {
          // For direct OAuth (like YouTube), redirect in the same window
          window.location.href = response.authUrl;
        }
      } else {
        // Some error occurred
        setNotification({ 
          type: 'error', 
          message: response.message || `Failed to initiate ${platform} connection.` 
        });
        setLoadingPlatform(null);
        setConnectingPlatform(null);
      }
    } catch (error: any) {
      console.error('OAuth connect error:', error);
      setNotification({ 
        type: 'error', 
        message: error.message || `Failed to connect to ${platform}.` 
      });
      setLoadingPlatform(null);
      setConnectingPlatform(null);
    }
  };

  const confirmFakeAuth = async () => {
      if (!usernameInput && authStep === 1) return;
      
      setAuthStep(2);
      
      await new Promise(r => setTimeout(r, 1500));
      
      const newUsername = usernameInput.startsWith('@') ? usernameInput : `@${usernameInput}`;
      
      setSocials(socials.map(s => 
        s.platform === connectingPlatform 
        ? { ...s, connected: true, username: newUsername, status: 'active' } 
        : s
      ));
      
      setTimeout(() => {
          setShowFakeAuthWindow(false);
          setConnectingPlatform(null);
      }, 1000);
  };

  const handleDisconnect = async (platform: string) => {
    try {
      const result = await apiService.disconnectPlatform(platform);
      if (result.success) {
        setNotification({ type: 'success', message: `${platform} disconnected successfully.` });
        loadSocials();
      } else {
        throw new Error('Disconnect failed');
      }
    } catch (error: any) {
      setNotification({ type: 'error', message: error.message || `Failed to disconnect ${platform}.` });
    }
  };

  const getIcon = (platform: string) => {
      switch(platform) {
          case 'Instagram': return <Instagram className="w-6 h-6 text-white" />;
          case 'Facebook': return <Facebook className="w-6 h-6 text-white" />;
          case 'X': return <XLogo className="w-5 h-5 text-white" />;
          case 'LinkedIn': return <Linkedin className="w-6 h-6 text-white" />;
          case 'YouTube': return <Youtube className="w-6 h-6 text-white" />;
          case 'Pinterest': return <Pin className="w-6 h-6 text-white" />;
          case 'Reddit': return <MessageCircle className="w-6 h-6 text-white" />;
          default: return <Video className="w-6 h-6 text-white" />;
      }
  };

  const getBgColor = (platform: string) => {
    switch(platform) {
        case 'Instagram': return 'bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-600';
        case 'Facebook': return 'bg-[#1877F2]';
        case 'X': return 'bg-black';
        case 'LinkedIn': return 'bg-[#0A66C2]';
        case 'YouTube': return 'bg-[#FF0000]';
        case 'Pinterest': return 'bg-[#BD081C]';
        case 'Reddit': return 'bg-[#FF4500]';
        default: return 'bg-slate-500';
    }
  };

  const getCustomIcon = (platform: string) => {
       return getIcon(platform);
  };

  return (
    <div className="max-w-5xl mx-auto relative">
      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg shadow-lg border animate-in slide-in-from-top-2 duration-300 flex items-start gap-3 ${
          notification.type === 'success' 
            ? 'bg-green-50 border-green-200 text-green-800' 
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {notification.type === 'success' ? (
            <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-medium text-sm">{notification.message}</p>
          </div>
          <button onClick={() => setNotification(null)} className="text-current opacity-50 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="mb-8 flex justify-between items-end">
        <div>
            <h1 className={`text-2xl font-bold ${theme.text}`}>Connect Socials</h1>
            <p className={theme.textSecondary}>Securely connect your platforms to enable auto-posting and analytics.</p>
        </div>
        <div className={`rounded-full px-4 py-1.5 flex items-center gap-2 text-xs font-bold ${
          isDarkMode ? 'bg-blue-500/20 border border-blue-400/30 text-blue-400' : 'bg-blue-50 border border-blue-200 text-blue-700'
        }`}>
            <ShieldCheck className="w-4 h-4" /> Secure OAuth 2.0 Connection
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {socials.map((social) => (
              <div key={social.platform} className={`rounded-xl p-5 shadow-sm border transition-all duration-200 relative overflow-hidden group ${theme.bgCard} ${
                social.connected 
                  ? isDarkMode ? 'border-green-500/30 ring-1 ring-green-500/20' : 'border-green-200 ring-1 ring-green-100' 
                  : isDarkMode ? 'border-slate-700/50 hover:border-slate-600 hover:shadow-md' : 'border-slate-200 hover:border-[#ffcc29]/30 hover:shadow-md'
              }`}>
                  {social.connected && (
                      <div className="absolute top-0 right-0 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-bl-lg">
                          CONNECTED
                      </div>
                  )}
                  
                  {/* Real OAuth badge for YouTube */}
                  {social.platform === 'YouTube' && !social.connected && (
                      <div className="absolute top-0 left-0 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-br-lg flex items-center gap-1">
                          <ExternalLink className="w-2.5 h-2.5" /> REAL OAUTH
                      </div>
                  )}
                  
                  <div className="flex items-start gap-4 mb-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm ${getBgColor(social.platform)}`}>
                          {getCustomIcon(social.platform)}
                      </div>
                      <div className="flex-1 min-w-0">
                          <h3 className={`font-bold text-base ${theme.text}`}>{social.platform}</h3>
                          {social.connected ? (
                              <p className={`text-xs font-medium truncate ${theme.textSecondary}`}>{social.username}</p>
                          ) : (
                              <p className="text-xs text-slate-400">Not connected</p>
                          )}
                          {/* Show analytics for connected accounts */}
                          {social.connected && social.analytics && (
                              <div className="flex gap-2 mt-1.5 text-[10px] text-slate-400">
                                  <span>{Number(social.analytics.followers).toLocaleString()} followers</span>
                                  <span>•</span>
                                  <span>{Number(social.analytics.following).toLocaleString()} following</span>
                                  <span>•</span>
                                  <span>{Number(social.analytics.posts).toLocaleString()} posts</span>
                              </div>
                          )}
                          {/* Show YouTube stats if connected */}
                          {social.platform === 'YouTube' && social.connected && social.channelData && (
                              <div className="flex gap-2 mt-1.5 text-[10px] text-slate-400">
                                  <span>{Number(social.channelData.subscriberCount).toLocaleString()} subs</span>
                                  <span>•</span>
                                  <span>{Number(social.channelData.videoCount).toLocaleString()} videos</span>
                              </div>
                          )}
                      </div>
                  </div>
                  
                  <div className="flex items-center gap-2 mt-auto">
                      {social.connected ? (
                           <>
                             <button className={`flex-1 py-2 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 ${
                               isDarkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                             }`}>
                                <RefreshCw className="w-3 h-3" /> Sync
                             </button>
                             <button 
                                onClick={() => handleDisconnect(social.platform)}
                                className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors ${
                                  isDarkMode 
                                    ? 'bg-[#0f1419] border border-slate-700/50 text-slate-400 hover:text-red-400 hover:border-red-400/30' 
                                    : 'bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200'
                                }`}
                             >
                                Unlink
                             </button>
                           </>
                      ) : (
                          <button 
                            onClick={() => initiateConnection(social.platform)}
                            disabled={loadingPlatform === social.platform}
                            className="w-full py-2.5 bg-[#ffcc29] hover:bg-[#ffcc29]/80 disabled:opacity-50 disabled:cursor-wait text-black text-xs font-bold rounded-lg transition-all shadow-sm flex items-center justify-center gap-2"
                          >
                             {loadingPlatform === social.platform ? (
                               <>
                                 <Loader2 className="w-3 h-3 animate-spin" /> Connecting...
                               </>
                             ) : (
                               <>Connect {social.platform}</>
                             )}
                          </button>
                      )}
                  </div>
              </div>
          ))}
      </div>

      {/* Simulated OAuth Popup Modal */}
      {showFakeAuthWindow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
              <div className={`w-full max-w-md rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh] ${theme.bgCard}`}>
                  {/* Fake Browser Header */}
                  <div className={`border-b p-3 flex items-center gap-2 flex-shrink-0 ${
                    isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-100 border-slate-200'
                  }`}>
                      <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-400"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                          <div className="w-3 h-3 rounded-full bg-green-400"></div>
                      </div>
                      <div className={`flex-1 border rounded text-[10px] px-2 py-1 text-center truncate mx-4 flex items-center justify-center gap-1 ${
                        isDarkMode ? 'bg-[#0f1419] border-slate-700/50 text-slate-400' : 'bg-white border-slate-200 text-slate-500'
                      }`}>
                          <div className="w-2 h-2 rounded-full bg-green-500"></div>
                          https://api.{connectingPlatform?.toLowerCase()}.com/oauth/v2/authorize
                      </div>
                  </div>

                  <div className="p-8 text-center flex-1 flex flex-col items-center justify-center overflow-y-auto">
                      {authStep === 0 && (
                          <div className="space-y-4">
                              <div className="relative">
                                  <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center opacity-50 ${getBgColor(connectingPlatform || '')}`}>
                                      {getCustomIcon(connectingPlatform || '')}
                                  </div>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                      <Loader2 className="w-8 h-8 text-white animate-spin drop-shadow-md" />
                                  </div>
                              </div>
                              <p className={`font-medium animate-pulse ${theme.textSecondary}`}>Contacting {connectingPlatform}...</p>
                          </div>
                      )}

                      {authStep === 1 && (
                          <div className="space-y-6 w-full animate-in slide-in-from-bottom-4 duration-300">
                              <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center shadow-lg ${getBgColor(connectingPlatform || '')}`}>
                                  {getCustomIcon(connectingPlatform || '')}
                              </div>
                              <div>
                                  <h3 className={`text-xl font-bold ${theme.text}`}>Authorize Nebulaa Gravity</h3>
                                  <p className={`text-sm mt-2 ${theme.textSecondary}`}>
                                      Nebulaa Gravity is requesting access to your {connectingPlatform} account to publish posts and view analytics.
                                  </p>
                              </div>

                              <div className={`text-left p-4 rounded-lg border text-sm ${
                                isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-slate-50 border-slate-200'
                              }`}>
                                  <label className={`block text-xs font-bold uppercase mb-1 ${theme.textSecondary}`}>Enter {connectingPlatform} Username</label>
                                  <input 
                                    type="text" 
                                    autoFocus
                                    className={`w-full p-2 border rounded focus:ring-2 focus:ring-[#ffcc29] outline-none ${
                                      isDarkMode ? 'bg-[#0f1419] border-slate-700/50 text-white' : 'bg-white border-slate-300 text-slate-900'
                                    }`}
                                    placeholder="e.g. gravity_official"
                                    value={usernameInput}
                                    onChange={(e) => setUsernameInput(e.target.value)}
                                  />
                              </div>

                              <div className="flex flex-col gap-3 w-full">
                                  <button 
                                    onClick={confirmFakeAuth}
                                    disabled={!usernameInput}
                                    className="w-full bg-[#ffcc29] hover:bg-[#ffcc29]/80 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg shadow-md transition-colors"
                                  >
                                      Authorize App
                                  </button>
                                  <button 
                                    onClick={() => setShowFakeAuthWindow(false)}
                                    className={`w-full border font-bold py-3 rounded-lg transition-colors ${
                                      isDarkMode ? 'bg-[#0f1419] border-slate-700/50 text-slate-400 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                      Cancel
                                  </button>
                              </div>
                              <p className="text-[10px] text-slate-400">
                                  By authorizing, you agree to our Terms of Service.
                              </p>
                          </div>
                      )}

                      {authStep === 2 && (
                          <div className="space-y-6 animate-in zoom-in duration-300">
                              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600 shadow-sm">
                                  <Check className="w-10 h-10" />
                              </div>
                              <div>
                                <h3 className={`text-xl font-bold ${theme.text}`}>Successfully Connected!</h3>
                                <p className={`mt-1 ${theme.textSecondary}`}>Redirecting you back to the dashboard...</p>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default ConnectSocials;