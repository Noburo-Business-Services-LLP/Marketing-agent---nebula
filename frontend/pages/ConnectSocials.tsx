import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiService } from '../services/api';
import { SocialConnection } from '../types';
import { Loader2, RefreshCw, Check, X, Instagram, Facebook, Linkedin, Youtube, Video, AlertCircle, ShieldCheck, MessageCircle, Pin, ExternalLink, Inbox, Lock, Bell, Sparkles, Tag, Activity, KeyRound, RadioTower, ArrowRight, CheckCircle2, Clock3 } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';
import UnifiedInbox from './UnifiedInbox';
import AutoReplySettingsPage from './AutoReplySettingsPage';

// X (Twitter) logo SVG component
const XLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

type InboxSummary = {
  success: boolean;
  connectedPlatforms: string[];
  connectedPlatformCount: number;
  unreadMessageCount: number;
  inboxEnabled: boolean;
  inboxStatus: string;
  syncStatus: {
    status: string;
    lastSyncAt?: string | null;
    nextSyncAt?: string | null;
  };
  webhookStatus: {
    registered: boolean;
    activePlatforms: string[];
    missingPlatforms: string[];
  };
  aiEngagement: {
    replySuggestions: boolean;
    priorityTagging: boolean;
    unreadAlerts: boolean;
  };
};

const INBOX_PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'X', 'YouTube'];

const ConnectSocials: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const location = useLocation();
  const navigate = useNavigate();
  const [socials, setSocials] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [inboxSummary, setInboxSummary] = useState<InboxSummary | null>(null);
  const [inboxSummaryLoading, setInboxSummaryLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Connection State
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [showFakeAuthWindow, setShowFakeAuthWindow] = useState(false);
  const [manualAuthUrl, setManualAuthUrl] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState(0); // 0: loading, 1: consent, 2: success
  const [usernameInput, setUsernameInput] = useState('');
  const authPopupRef = useRef<Window | null>(null);
  const authPopupMonitorRef = useRef<number | null>(null);
  
  // Loading states per platform
  const [loadingPlatform, setLoadingPlatform] = useState<string | null>(null);
  const isInboxRoute = location.pathname.startsWith('/connect-socials/inbox');
  const connectedSocials = socials.filter(social => social.connected);
  const connectedPlatformCount = inboxSummary?.connectedPlatformCount ?? connectedSocials.length;
  const inboxEnabled = (inboxSummary?.inboxEnabled ?? connectedPlatformCount > 0) && connectedPlatformCount > 0;
  const unreadMessageCount = inboxSummary?.unreadMessageCount ?? 0;

  const clearAuthPopupMonitor = () => {
    if (authPopupMonitorRef.current !== null) {
      window.clearInterval(authPopupMonitorRef.current);
      authPopupMonitorRef.current = null;
    }
  };

  const startAuthPopupMonitor = (platform: string, popup: Window) => {
    clearAuthPopupMonitor();
    authPopupRef.current = popup;

    authPopupMonitorRef.current = window.setInterval(async () => {
      // Check if popup was closed by user
      if (!popup || popup.closed) {
        clearAuthPopupMonitor();
        authPopupRef.current = null;
        setLoadingPlatform(null);
        setConnectingPlatform(null);

        try {
          await loadSocials();
        } catch (error) {
          console.error(`Failed to refresh ${platform} status after auth window closed:`, error);
        }
        return;
      }

      // Ayrshare sometimes gets stuck on "Almost done gathering social networks..."
      // To fix this, we actively poll our backend. If it's connected, we force close the popup!
      try {
        const res = await apiService.getSocials();
        const connections = res.connections || [];
        const targetPlatform = connections.find(s => 
          s.platform.toLowerCase() === platform.toLowerCase() || 
          (s.platform === 'X' && platform.toLowerCase() === 'twitter') || 
          (s.platform === 'Twitter' && platform.toLowerCase() === 'x')
        );

        if (targetPlatform && targetPlatform.connected) {
          console.log(`[Auth Monitor] Detected ${platform} is connected in backend! Forcing popup close.`);
          popup.close();
          clearAuthPopupMonitor();
          authPopupRef.current = null;
          setLoadingPlatform(null);
          setConnectingPlatform(null);
          setManualAuthUrl(null);
          
          setNotification({
            type: 'success',
            message: `${platform} connected successfully!`
          });
          
          setSocials(connections);
          apiService.registerWebhook().catch(console.error);
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 2000);
  };

  const writePopupLoadingState = (popup: Window, platform: string) => {
    try {
      popup.document.write(`
        <html>
          <head><title>Connecting ${platform}</title></head>
          <body style="margin:0;font-family:sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;">
            <div style="text-align:center;max-width:420px;padding:24px;">
              <div style="font-size:18px;font-weight:700;margin-bottom:12px;">Preparing ${platform} connection...</div>
              <div style="font-size:14px;color:#94a3b8;">This window will redirect to the secure auth flow in a moment.</div>
            </div>
          </body>
        </html>
      `);
      popup.document.close();
    } catch (_) {}
  };

  const openAuthPopup = (authUrl: string, platform: string, existingPopup?: Window | null) => {
    const popupName = `nebula-social-${platform.toLowerCase()}`;
    const popup =
      existingPopup && !existingPopup.closed
        ? existingPopup
        : window.open('', popupName, 'width=640,height=820,menubar=no,toolbar=no,status=no,scrollbars=yes,resizable=yes');

    if (!popup) {
      setManualAuthUrl(authUrl);
      setNotification({
        type: 'error',
        message: `Your browser blocked the ${platform} auth window. Click "Open Auth Page" to launch it in a new tab.`
      });
      return false;
    }

    try {
      popup.location.href = authUrl;
      popup.focus();
      setManualAuthUrl(null);
      setNotification({
        type: 'success',
        message: `Finish connecting ${platform} in the new window. This page will stay open.`
      });
      startAuthPopupMonitor(platform, popup);
      return true;
    } catch (error) {
      console.error(`Failed to open ${platform} auth popup:`, error);
      setManualAuthUrl(authUrl);
      setNotification({
        type: 'error',
        message: `Could not open the ${platform} auth window automatically. Click "Open Auth Page" to continue.`
      });
      return false;
    }
  };

  useEffect(() => {
    // Check URL params for OAuth callback results
    const searchParams = new URLSearchParams(location.search);
    const error = searchParams.get('error');
    const account = searchParams.get('account');
    
    // Check for successful connections for each platform
    const platforms = ['instagram', 'facebook', 'x', 'linkedin'];
    let foundConnection = false;
    for (const platform of platforms) {
      const status = searchParams.get(platform);
      if (status === 'connected') {
        foundConnection = true;
        const displayName = platform.charAt(0).toUpperCase() + platform.slice(1);
        
        // ✅ KEY FIX: If we're inside the Ayrshare popup window (window.opener exists),
        // auto-close this window so the user returns to the original tab automatically.
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage({
              type: 'nebula-social-connected',
              platform,
              account: account ? decodeURIComponent(account) : null
            }, window.location.origin);
          } catch (_) {}

          // Show a brief success page then close
          document.title = `${displayName} Connected ✅`;
          document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#0f172a;color:#fff;gap:16px;">
              <div style="font-size:48px;">✅</div>
              <h2 style="margin:0;font-size:22px;">${displayName} Connected Successfully!</h2>
              <p style="margin:0;color:#94a3b8;">Closing this window...</p>
            </div>
          `;
          setTimeout(() => window.close(), 1500);
          return;
        }
        
        setNotification({
          type: 'success',
          message: `${displayName}${account ? ` (${decodeURIComponent(account)})` : ''} connected successfully!`
        });
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => {
          loadSocials();
          apiService.registerWebhook().catch(console.error);
        }, 500);
        break;
      }
    }
    
    if (!foundConnection) {
      loadSocials();
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

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const isSelf = event.origin === window.location.origin;
      const isAyrshare = event.origin.includes('ayrshare.com');

      if (!isSelf && !isAyrshare) return;

      // If Ayrshare sends any message (like success or close), try to force close the popup
      if (isAyrshare) {
        if (authPopupRef.current && !authPopupRef.current.closed) {
          authPopupRef.current.close();
        }
        return; // Let the monitor handle the success toast by polling
      }

      if (event.data?.type !== 'nebula-social-connected') return;

      const platform = String(event.data.platform || '');
      const displayName = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Social account';
      const accountName = event.data.account ? ` (${event.data.account})` : '';

      clearAuthPopupMonitor();
      authPopupRef.current = null;
      setLoadingPlatform(null);
      setConnectingPlatform(null);
      setManualAuthUrl(null);
      setNotification({
        type: 'success',
        message: `${displayName}${accountName} connected successfully!`
      });
      
      // Optimistic update
      setSocials(prev => prev.map(s => 
        s.platform.toLowerCase() === platform.toLowerCase() || 
        (s.platform === 'X' && platform.toLowerCase() === 'twitter') || 
        (s.platform === 'Twitter' && platform.toLowerCase() === 'x')
          ? { ...s, connected: true, status: 'active', username: event.data.account || displayName } 
          : s
      ));
      
      setTimeout(() => {
        loadSocials();
      }, 2000);
      
      apiService.registerWebhook().catch(console.error);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    return () => clearAuthPopupMonitor();
  }, []);

  // Auto-dismiss notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 12000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const loadSocials = async () => {
    try {
      const res = await apiService.getSocials();
      setSocials(res.connections || []);
      loadInboxSummary(res.connections || []);
    } catch (e) {
      console.error(e);
      setNotification({ type: "error", message: "Could not load social connection status. Please try again in a moment." });
    } finally {
      setLoading(false);
    }
  };

  const loadInboxSummary = async (currentSocials: SocialConnection[] = socials) => {
    setInboxSummaryLoading(true);
    try {
      const summary = await apiService.getSocialInboxSummary();
      setInboxSummary(summary);
    } catch (error) {
      const connected = currentSocials.filter(social => social.connected).map(social => social.platform);
      setInboxSummary({
        success: false,
        connectedPlatforms: connected,
        connectedPlatformCount: connected.length,
        unreadMessageCount: 0,
        inboxEnabled: connected.length > 0,
        inboxStatus: connected.length > 0 ? 'needs_setup' : 'disabled',
        syncStatus: { status: connected.length > 0 ? 'pending' : 'not_started', lastSyncAt: null, nextSyncAt: null },
        webhookStatus: { registered: false, activePlatforms: [], missingPlatforms: connected },
        aiEngagement: { replySuggestions: true, priorityTagging: true, unreadAlerts: true },
      });
    } finally {
      setInboxSummaryLoading(false);
    }
  };

  const initiateConnection = async (platform: string) => {
    setManualAuthUrl(null);
    setLoadingPlatform(platform);
    setConnectingPlatform(platform);
    const popupName = `nebula-social-${platform.toLowerCase()}`;
    const pendingPopup = window.open('', popupName, 'width=640,height=820,menubar=no,toolbar=no,status=no,scrollbars=yes,resizable=yes');

    if (pendingPopup) {
      writePopupLoadingState(pendingPopup, platform);
    }

    try {
      const response = await apiService.getPlatformAuthUrl(platform);

      if (response.success && response.authUrl) {
        console.log("Received connect URL from backend:", response.authUrl);
        const opened = openAuthPopup(response.authUrl, platform, pendingPopup);
        if (opened) {
          setLoadingPlatform(null);
          return;
        }

        if (pendingPopup && !pendingPopup.closed) {
          pendingPopup.close();
        }
        setLoadingPlatform(null);
        setConnectingPlatform(null);
      } else {
        if (pendingPopup && !pendingPopup.closed) {
          pendingPopup.close();
        }
        setNotification({
          type: 'error',
          message: response.message || `Failed to initiate ${platform} connection.`
        });
        setLoadingPlatform(null);
        setConnectingPlatform(null);
      }
    } catch (error: any) {
      if (pendingPopup && !pendingPopup.closed) {
        pendingPopup.close();
      }
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
        
        // Optimistic UI update
        setSocials(prev => prev.map(s => 
          s.platform.toLowerCase() === platform.toLowerCase() || 
          (s.platform === 'X' && platform.toLowerCase() === 'twitter') || 
          (s.platform === 'Twitter' && platform.toLowerCase() === 'x')
            ? { ...s, connected: false, status: 'inactive', username: undefined, channelData: undefined, analytics: undefined } 
            : s
        ));
        
        // Refresh from backend after a delay to allow Ayrshare to process the disconnect
        setTimeout(() => {
          loadSocials();
        }, 2000);
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

  const isPlatformConnected = (platform: string) => {
    const normalized = platform.toLowerCase();
    return connectedSocials.some(social => {
      const socialPlatform = social.platform.toLowerCase();
      return socialPlatform === normalized ||
        (normalized === 'x' && socialPlatform === 'twitter') ||
        (normalized === 'twitter' && socialPlatform === 'x');
    });
  };

  const tabs = [
    { id: 'accounts', label: 'Accounts', icon: ShieldCheck, path: '/connect-socials' },
    { id: 'permissions', label: 'Permissions', icon: KeyRound, path: '/connect-socials?tab=permissions' },
    { id: 'sync', label: 'Sync Status', icon: Activity, path: '/connect-socials?tab=sync' },
    { id: 'inbox', label: 'Social Inbox', icon: Inbox, path: '/connect-socials/inbox' },
    { id: 'auto-reply', label: 'AI Auto Reply', icon: Sparkles, path: '/connect-socials?tab=auto-reply' },
  ];
  const activeTab = isInboxRoute ? 'inbox' : new URLSearchParams(location.search).get('tab') || 'accounts';

  const handleTabClick = (tab: typeof tabs[number]) => {
    navigate(tab.path);
  };

  const openInbox = () => {
    if (!inboxEnabled) return;
    navigate('/connect-socials/inbox');
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

      {manualAuthUrl && (
        <div className="fixed top-20 right-4 z-50 max-w-md p-4 rounded-lg shadow-lg border bg-yellow-50 border-yellow-200 text-yellow-900 animate-in slide-in-from-top-2 duration-300">
          <p className="text-sm mb-2">Your browser blocked the automatic redirect to Ayrshare.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => manualAuthUrl && openAuthPopup(manualAuthUrl, connectingPlatform || 'social')}
              className="flex-1 text-center bg-yellow-400 text-black font-bold rounded px-3 py-2 hover:bg-yellow-300"
            >
              Open Auth Page
            </button>
            <button
              onClick={() => setManualAuthUrl(null)}
              className="bg-white border border-yellow-300 text-yellow-900 rounded px-3 py-2 hover:bg-yellow-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mb-8 flex justify-between items-end">
        <div>
            <h1 className={`text-2xl font-bold ${theme.text}`}>Connect Socials</h1>
            <p className={theme.textSecondary}>Securely connect your platforms to enable auto-posting and analytics.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadSocials()}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDarkMode
                ? 'bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:bg-slate-800 disabled:text-slate-500'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:bg-slate-50 disabled:text-slate-400'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
          <div className={`rounded-full px-4 py-1.5 flex items-center gap-2 text-xs font-bold ${
            isDarkMode ? 'bg-blue-500/20 border border-blue-400/30 text-blue-400' : 'bg-blue-50 border border-blue-200 text-blue-700'
          }`}>
              <ShieldCheck className="w-4 h-4" /> Secure OAuth 2.0 Connection
          </div>
        </div>
      </div>

      <div className={`mb-6 flex flex-wrap gap-2 rounded-xl border p-2 ${isDarkMode ? 'bg-[#0d1117] border-slate-700/50' : 'bg-white border-slate-200'}`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                active
                  ? 'bg-[#ffcc29] text-[#070A12]'
                  : isDarkMode
                    ? 'text-slate-300 hover:bg-slate-800'
                    : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'accounts' && (
        <>
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
                              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[10px] text-slate-400">
                                  <span>{Number(social.analytics.followers).toLocaleString()} followers</span>
                                  {/* LinkedIn doesn't provide following/posts count */}
                                  {social.platform !== 'LinkedIn' && (
                                    <>
                                      <span>•</span>
                                      <span>{Number(social.analytics.following).toLocaleString()} following</span>
                                    </>
                                  )}
                                  {social.platform !== 'LinkedIn' && social.platform !== 'Facebook' && (
                                    <>
                                      <span>•</span>
                                      <span>{Number(social.analytics.posts).toLocaleString()} posts</span>
                                    </>
                                  )}
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

      <div className={`mt-8 rounded-2xl border overflow-hidden ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
        <div className={`p-5 border-b ${isDarkMode ? 'border-slate-700/50 bg-[#0d1117]' : 'border-slate-100 bg-slate-50'}`}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#ffcc29] text-[#070A12] flex items-center justify-center shrink-0">
                <Inbox className="w-6 h-6" />
              </div>
              <div>
                <h2 className={`text-xl font-bold ${theme.text}`}>Social Inbox</h2>
                <p className={`mt-1 text-sm max-w-2xl ${theme.textSecondary}`}>
                  Manage messages, comments, mentions, and replies from all connected social platforms in one place.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openInbox}
              disabled={!inboxEnabled}
              className="px-5 py-3 rounded-lg bg-[#ffcc29] text-[#070A12] font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {inboxEnabled ? <Inbox className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              Open Unified Social Inbox
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Inbox Status</p>
                <p className={`mt-2 text-lg font-bold capitalize ${inboxEnabled ? 'text-green-400' : 'text-slate-400'}`}>
                  {inboxSummaryLoading ? 'Checking...' : inboxEnabled ? (inboxSummary?.inboxStatus || 'Active') : 'Disabled'}
                </p>
              </div>
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Connected Platforms</p>
                <p className={`mt-2 text-lg font-bold ${theme.text}`}>{connectedPlatformCount}</p>
              </div>
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Unread Messages</p>
                <p className={`mt-2 text-lg font-bold ${unreadMessageCount > 0 ? 'text-[#ffcc29]' : theme.text}`}>{unreadMessageCount}</p>
              </div>
            </div>

            {!inboxEnabled && (
              <div className={`rounded-xl border p-4 flex items-center gap-3 ${isDarkMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm font-medium">Connect social accounts to enable inbox management.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="w-4 h-4 text-[#ffcc29]" /> AI reply suggestions
                </div>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Draft fast, on-brand responses for conversations.</p>
              </div>
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Tag className="w-4 h-4 text-[#ffcc29]" /> Priority tagging
                </div>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Spot urgent leads, complaints, and high-value messages.</p>
              </div>
              <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Bell className="w-4 h-4 text-[#ffcc29]" /> Unread alerts
                </div>
                <p className={`mt-1 text-xs ${theme.textSecondary}`}>Never miss engagement that needs a response.</p>
              </div>
            </div>
          </div>

          <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-3 ${theme.textSecondary}`}>Platform Indicators</p>
            <div className="space-y-2">
              {INBOX_PLATFORMS.map(platform => {
                const connected = isPlatformConnected(platform);
                return (
                  <div key={platform} className={`flex items-center justify-between rounded-lg px-3 py-2 ${isDarkMode ? 'bg-[#0d1117]' : 'bg-slate-50'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${getBgColor(platform)}`}>
                        {getCustomIcon(platform)}
                      </div>
                      <span className={`text-sm font-medium ${theme.text}`}>{platform === 'X' ? 'X/Twitter' : platform}</span>
                    </div>
                    <span className={`text-xs font-bold ${connected ? 'text-green-400' : 'text-slate-400'}`}>
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {activeTab === 'permissions' && (
        <div className={`rounded-2xl border p-6 ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <h2 className={`text-xl font-bold ${theme.text}`}>Permissions</h2>
          <p className={`mt-1 text-sm ${theme.textSecondary}`}>Nebulaa requests only the scopes needed for publishing, analytics, comments, mentions, webhooks, and inbox replies.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            {[
              ['OAuth Authentication', 'Secure account linking through provider-approved OAuth flows.'],
              ['Webhook Registration', 'Incoming messages, comments, mentions, and replies are delivered to Nebulaa in real time.'],
              ['Reply Access', 'Replies are sent back through the original connected platform API.'],
              ['Analytics Read Access', 'Used to show performance, follower, and sync health signals.'],
            ].map(([title, description]) => (
              <div key={title} className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-400 mt-0.5" />
                  <div>
                    <p className={`font-semibold ${theme.text}`}>{title}</p>
                    <p className={`text-sm mt-1 ${theme.textSecondary}`}>{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'sync' && (
        <div className={`rounded-2xl border p-6 ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className={`text-xl font-bold ${theme.text}`}>Sync Status</h2>
              <p className={`mt-1 text-sm ${theme.textSecondary}`}>Track social account syncs, webhook health, and inbox readiness.</p>
            </div>
            <button onClick={() => { loadSocials(); loadInboxSummary(); }} className="px-4 py-2 rounded-lg bg-[#ffcc29] text-[#070A12] text-sm font-bold flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
            <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
              <Activity className="w-5 h-5 text-[#ffcc29]" />
              <p className={`mt-3 text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Sync</p>
              <p className={`mt-1 text-lg font-bold capitalize ${theme.text}`}>{inboxSummary?.syncStatus?.status || 'Not started'}</p>
              <p className={`text-xs mt-1 ${theme.textSecondary}`}>Last sync: {inboxSummary?.syncStatus?.lastSyncAt ? new Date(inboxSummary.syncStatus.lastSyncAt).toLocaleString() : 'Not available'}</p>
            </div>
            <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
              <RadioTower className="w-5 h-5 text-[#ffcc29]" />
              <p className={`mt-3 text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Webhooks</p>
              <p className={`mt-1 text-lg font-bold ${inboxSummary?.webhookStatus?.registered ? 'text-green-400' : theme.text}`}>{inboxSummary?.webhookStatus?.registered ? 'Registered' : 'Pending'}</p>
              <p className={`text-xs mt-1 ${theme.textSecondary}`}>{inboxSummary?.webhookStatus?.activePlatforms?.length || 0} active platform hooks</p>
            </div>
            <div className={`rounded-xl border p-4 ${isDarkMode ? 'border-slate-700/50 bg-[#0f1419]' : 'border-slate-200 bg-white'}`}>
              <Clock3 className="w-5 h-5 text-[#ffcc29]" />
              <p className={`mt-3 text-xs font-semibold uppercase tracking-wide ${theme.textSecondary}`}>Next Sync</p>
              <p className={`mt-1 text-lg font-bold ${theme.text}`}>{inboxSummary?.syncStatus?.nextSyncAt ? new Date(inboxSummary.syncStatus.nextSyncAt).toLocaleTimeString() : 'On demand'}</p>
              <p className={`text-xs mt-1 ${theme.textSecondary}`}>Background queue runs for connected platforms.</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inbox' && (
        inboxEnabled ? (
          <div className="space-y-4">
            <div className={`rounded-2xl border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
              <div>
                <h2 className={`text-lg font-bold ${theme.text}`}>Unified Social Inbox</h2>
                <p className={`text-sm ${theme.textSecondary}`}>Real comments, DMs, mentions, and replies from connected social accounts.</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-green-400">
                <CheckCircle2 className="w-4 h-4" /> {connectedPlatformCount} connected
              </div>
            </div>
            <UnifiedInbox />
          </div>
        ) : (
          <div className={`rounded-2xl border p-8 text-center ${theme.bgCard} ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'}`}>
            <Lock className="w-10 h-10 mx-auto text-slate-400" />
            <h2 className={`mt-3 text-xl font-bold ${theme.text}`}>Social Inbox is disabled</h2>
            <p className={`mt-1 text-sm ${theme.textSecondary}`}>Connect social accounts to enable inbox management.</p>
            <button onClick={() => navigate('/connect-socials')} className="mt-5 px-5 py-3 rounded-lg bg-[#ffcc29] text-[#070A12] font-bold inline-flex items-center gap-2">
              Connect Accounts <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )
      )}

      {activeTab === 'auto-reply' && (
        <AutoReplySettingsPage />
      )}

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
                                  By authorizing, you agree to our <a href="/#/terms" className="text-[#ffcc29] hover:underline">Terms of Service</a>.
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
