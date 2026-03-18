import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Check, CheckCheck, Clock, Calendar, Trash2, ExternalLink } from 'lucide-react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

interface Notification {
  _id: string;
  type: string;
  title: string;
  message: string;
  campaignId?: string;
  scheduledFor: string;
  sentAt: string;
  readAt: string | null;
  status: string;
  metadata: {
    campaignName: string;
    platforms: string[];
    scheduledTime: string;
  };
  createdAt: string;
}

const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      const res = await apiService.getNotifications({ limit: 10 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  // Force check notifications for scheduled campaigns
  const handleCheckNow = async () => {
    setChecking(true);
    try {
      const res = await apiService.checkNotificationsNow();
      console.log('Check result:', res);
      if (res.notifications && res.notifications.length > 0) {
        alert(`✅ Created ${res.notifications.length} notification(s)!`);
      } else if (res.campaigns && res.campaigns.length > 0) {
        alert(`ℹ️ Found ${res.campaigns.length} scheduled campaign(s) but no notifications were due yet.`);
      } else {
        alert('ℹ️ No scheduled campaigns found.');
      }
      // Refresh notifications
      await fetchNotifications();
    } catch (error: any) {
      console.error('Check failed:', error);
      alert('Failed to check notifications: ' + (error.message || 'Unknown error'));
    } finally {
      setChecking(false);
    }
  };

  // Fetch unread count periodically
  useEffect(() => {
    fetchNotifications();
    
    // Poll for new notifications every 30 seconds
    const interval = setInterval(async () => {
      try {
        const count = await apiService.getUnreadNotificationCount();
        setUnreadCount(count);
        
        // If there are new unread notifications, show browser notification
        if (count > unreadCount && count > 0) {
          showBrowserNotification();
          fetchNotifications();
        }
      } catch (error) {
        // Silent fail
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [unreadCount]);

  // Show browser notification
  const showBrowserNotification = () => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const latestUnread = notifications.find(n => !n.readAt);
      if (latestUnread) {
        new Notification('Campaign Reminder', {
          body: latestUnread.message,
          icon: '/assets/logo.png',
          tag: 'campaign-reminder'
        });
      }
    }
  };

  // Request browser notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark notification as read
  const handleMarkRead = async (id: string) => {
    try {
      await apiService.markNotificationRead(id);
      setNotifications(prev => 
        prev.map(n => n._id === id ? { ...n, readAt: new Date().toISOString(), status: 'read' } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  // Mark all as read
  const handleMarkAllRead = async () => {
    try {
      await apiService.markAllNotificationsRead();
      setNotifications(prev => 
        prev.map(n => ({ ...n, readAt: new Date().toISOString(), status: 'read' }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Delete notification
  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteNotification(id);
      setNotifications(prev => prev.filter(n => n._id !== id));
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // Format time ago
  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Get notification icon based on type
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'campaign_reminder_30':
      case 'campaign_reminder_15':
        return <Clock className="w-4 h-4 text-[#ffcc29]" />;
      case 'campaign_live':
        return <Calendar className="w-4 h-4 text-green-500" />;
      default:
        return <Bell className="w-4 h-4 text-blue-500" />;
    }
  };

  // Navigate to campaign details
  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read when clicked
    if (!notification.readAt) {
      await handleMarkRead(notification._id);
    }
    
    // Close the dropdown
    setIsOpen(false);
    
    // Navigate to campaigns page with the campaign ID as a query param
    if (notification.campaignId) {
      navigate(`/campaigns?selected=${notification.campaignId}`);
    } else {
      // Fallback: just navigate to campaigns page
      navigate('/campaigns');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className={`relative p-2 rounded-lg transition-colors ${
          isDarkMode 
            ? 'hover:bg-[#ededed]/10 text-[#ededed]' 
            : 'hover:bg-gray-100 text-gray-700'
        }`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className={`absolute right-0 mt-2 w-80 max-h-96 overflow-hidden rounded-xl shadow-xl border z-50 ${
          isDarkMode 
            ? 'bg-[#0d1117] border-slate-700/50' 
            : 'bg-white border-gray-200'
        }`}>
          {/* Header */}
          <div className={`px-4 py-3 border-b flex items-center justify-between ${
            isDarkMode ? 'border-slate-700/50' : 'border-gray-100'
          }`}>
            <h3 className={`font-bold ${theme.text}`}>Notifications</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCheckNow}
                disabled={checking}
                className="text-xs text-[#ffcc29] hover:underline flex items-center gap-1"
                title="Check for scheduled campaign notifications"
              >
                {checking ? '🔄' : '🔔'} Check
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-[#ffcc29] hover:underline flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className={`p-1 rounded hover:bg-[#ededed]/10 ${theme.textMuted}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className={`py-8 text-center ${theme.textMuted}`}>
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No notifications yet</p>
                <button
                  onClick={handleCheckNow}
                  disabled={checking}
                  className="mt-3 px-3 py-1.5 bg-[#ffcc29] text-black text-xs font-semibold rounded-lg hover:bg-[#e6b825] disabled:opacity-50"
                >
                  {checking ? '🔄 Checking...' : '🔔 Check Scheduled Campaigns'}
                </button>
              </div>
            ) : (
              notifications.map(notification => (
                <div
                  key={notification._id}
                  className={`px-4 py-3 border-b transition-colors cursor-pointer ${
                    isDarkMode ? 'border-[#ededed]/5' : 'border-gray-50'
                  } ${
                    !notification.readAt
                      ? isDarkMode ? 'bg-[#ffcc29]/5' : 'bg-yellow-50/50'
                      : ''
                  } hover:${isDarkMode ? 'bg-[#ededed]/5' : 'bg-gray-50'}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${theme.text}`}>
                          {notification.title}
                        </p>
                        {!notification.readAt && (
                          <span className="w-2 h-2 bg-[#ffcc29] rounded-full flex-shrink-0 mt-1.5" />
                        )}
                      </div>
                      <p className={`text-xs mt-0.5 ${theme.textMuted}`}>
                        {notification.message}
                      </p>
                      {notification.metadata?.platforms?.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {notification.metadata.platforms.map(p => (
                            <span 
                              key={p} 
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                isDarkMode ? 'bg-[#ededed]/10 text-[#ededed]/60' : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* View Campaign Link */}
                      <div className="flex items-center gap-1 mt-1.5">
                        <ExternalLink className="w-3 h-3 text-[#ffcc29]" />
                        <span className="text-[10px] text-[#ffcc29] font-medium hover:underline">
                          View Campaign Details
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <span className={`text-[10px] ${theme.textMuted}`}>
                          {formatTimeAgo(notification.sentAt || notification.createdAt)}
                        </span>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {!notification.readAt && (
                            <button
                              onClick={() => handleMarkRead(notification._id)}
                              className="p-1 rounded hover:bg-[#ffcc29]/20 text-[#ffcc29]"
                              title="Mark as read"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(notification._id)}
                            className={`p-1 rounded hover:bg-red-500/20 text-red-400`}
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
