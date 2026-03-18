import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, Clock, Calendar, Megaphone, AlertTriangle } from 'lucide-react';
import { apiService } from '../services/api';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

interface CampaignReminder {
  _id: string;
  type: string;
  title: string;
  message: string;
  scheduledFor: string;
  status: string;
  metadata: {
    campaignName: string;
    platforms: string[];
    scheduledTime: string;
    scheduledTimeISO?: string; // ISO format for accurate time calculation
  };
  createdAt: string;
  dismissed?: boolean;
}

const CampaignReminderPopup: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [activeReminders, setActiveReminders] = useState<CampaignReminder[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Check for new reminders every 30 seconds
  const checkForReminders = useCallback(async () => {
    try {
      const { notifications } = await apiService.getNotifications({ limit: 20 });
      
      // Filter for unread campaign reminders that haven't been dismissed locally
      // Include both 'sent' and 'pending' notifications that are due
      const now = new Date();
      const newReminders = notifications.filter((n: CampaignReminder) => 
        (n.type === 'campaign_reminder_30' || n.type === 'campaign_reminder_15') &&
        (n.status === 'sent' || (n.status === 'pending' && new Date(n.scheduledFor) <= now)) &&
        !dismissedIds.has(n._id)
      );

      // Only show reminders that are within the last hour (to avoid showing old ones)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentReminders = newReminders.filter((n: CampaignReminder) => 
        new Date(n.createdAt) > oneHourAgo
      );

      if (recentReminders.length > 0) {
        setActiveReminders(recentReminders);
        
        // Play notification sound
        playNotificationSound();
      }
    } catch (error) {
      // Silent fail
    }
  }, [dismissedIds]);

  // Initial check and interval
  useEffect(() => {
    checkForReminders();
    
    const interval = setInterval(checkForReminders, 30000); // Check every 30 seconds
    
    return () => clearInterval(interval);
  }, [checkForReminders]);

  // Play a notification sound
  const playNotificationSound = () => {
    try {
      // Create a simple beep using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 200);
    } catch (e) {
      // Silent fail if audio not supported
    }
  };

  // Dismiss a reminder
  const dismissReminder = async (reminder: CampaignReminder) => {
    // Add to dismissed set immediately for UI responsiveness
    setDismissedIds(prev => new Set([...prev, reminder._id]));
    
    // Remove from active reminders
    setActiveReminders(prev => prev.filter(r => r._id !== reminder._id));
    
    // Mark as read on the server
    try {
      await apiService.markNotificationRead(reminder._id);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Dismiss all reminders
  const dismissAll = async () => {
    const currentIds = activeReminders.map(r => r._id);
    setDismissedIds(prev => new Set([...prev, ...currentIds]));
    setActiveReminders([]);
    
    try {
      await apiService.markAllNotificationsRead();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  };

  // Get time remaining text - calculate actual remaining time
  const getTimeRemaining = (reminder: CampaignReminder) => {
    try {
      // Use ISO format if available for accurate calculation
      const scheduledTimeStr = reminder.metadata.scheduledTimeISO || reminder.metadata.scheduledTime;
      if (scheduledTimeStr) {
        const scheduledDate = new Date(scheduledTimeStr);
        const now = new Date();
        const diffMs = scheduledDate.getTime() - now.getTime();
        const diffMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)));
        
        if (diffMinutes <= 0) {
          return 'now';
        } else if (diffMinutes === 1) {
          return '1 minute';
        } else if (diffMinutes < 60) {
          return `${diffMinutes} minutes`;
        } else {
          const hours = Math.floor(diffMinutes / 60);
          const mins = diffMinutes % 60;
          return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
        }
      }
    } catch (e) {
      // Fallback to type-based estimate
    }
    
    // Fallback based on notification type
    if (reminder.type === 'campaign_reminder_30') {
      return '~30 minutes';
    } else if (reminder.type === 'campaign_reminder_15') {
      return '~15 minutes';
    }
    return 'soon';
  };

  // Get urgency color
  const getUrgencyColor = (reminder: CampaignReminder) => {
    if (reminder.type === 'campaign_reminder_15') {
      return 'from-red-500 to-orange-500';
    }
    return 'from-[#ffcc29] to-orange-400';
  };

  if (activeReminders.length === 0) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9998]"
        onClick={dismissAll}
      />
      
      {/* Pop-up Container */}
      <div className="fixed inset-0 flex items-center justify-center z-[9999] p-4 pointer-events-none">
        <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto pointer-events-auto">
          {activeReminders.map((reminder, index) => (
            <div
              key={reminder._id}
              className={`
                relative w-full max-w-md mx-auto
                bg-gradient-to-br ${getUrgencyColor(reminder)}
                rounded-2xl shadow-2xl
                transform transition-all duration-300
                animate-bounce-in
              `}
              style={{
                animationDelay: `${index * 100}ms`
              }}
            >
              {/* Glowing ring effect */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent animate-pulse" />
              
              {/* Content */}
              <div className="relative p-6">
                {/* Close button */}
                <button
                  onClick={() => dismissReminder(reminder)}
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/20 hover:bg-black/40 transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>

                {/* Icon */}
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                    {reminder.type === 'campaign_reminder_15' ? (
                      <AlertTriangle className="w-8 h-8 text-white" />
                    ) : (
                      <Bell className="w-8 h-8 text-white animate-ring" />
                    )}
                  </div>
                </div>

                {/* Title */}
                <h2 className="text-center text-2xl font-bold text-white mb-2">
                  Campaign Reminder!
                </h2>

                {/* Time remaining badge */}
                <div className="flex justify-center mb-4">
                  <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/20 text-white font-semibold text-lg">
                    <Clock className="w-5 h-5" />
                    {getTimeRemaining(reminder)} left
                  </span>
                </div>

                {/* Campaign details */}
                <div className="bg-black/20 rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Megaphone className="w-5 h-5 text-white/80" />
                    <span className="text-white/80 text-sm">Campaign</span>
                  </div>
                  <h3 className="text-white font-bold text-xl mb-2">
                    {reminder.metadata.campaignName}
                  </h3>
                  
                  <div className="flex items-center gap-2 text-white/80 text-sm">
                    <Calendar className="w-4 h-4" />
                    <span>{reminder.metadata.scheduledTime}</span>
                  </div>

                  {reminder.metadata.platforms && reminder.metadata.platforms.length > 0 && (
                    <div className="flex gap-2 mt-3">
                      {reminder.metadata.platforms.map(platform => (
                        <span 
                          key={platform}
                          className="px-3 py-1 rounded-full bg-white/20 text-white text-xs capitalize"
                        >
                          {platform}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Message */}
                <p className="text-center text-white/90 mb-4">
                  {reminder.message}
                </p>

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => dismissReminder(reminder)}
                    className="flex-1 py-3 px-4 rounded-xl bg-white text-gray-800 font-semibold hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Dismiss all button if multiple reminders */}
          {activeReminders.length > 1 && (
            <button
              onClick={dismissAll}
              className="mx-auto py-2 px-6 rounded-full bg-white/90 text-gray-800 font-semibold hover:bg-white transition-colors shadow-lg"
            >
              Dismiss All ({activeReminders.length})
            </button>
          )}
        </div>
      </div>

      {/* Custom animations */}
      <style>{`
        @keyframes bounce-in {
          0% {
            opacity: 0;
            transform: scale(0.3) translateY(-50px);
          }
          50% {
            transform: scale(1.05);
          }
          70% {
            transform: scale(0.9);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes ring {
          0% { transform: rotate(0); }
          10% { transform: rotate(15deg); }
          20% { transform: rotate(-15deg); }
          30% { transform: rotate(10deg); }
          40% { transform: rotate(-10deg); }
          50% { transform: rotate(5deg); }
          60% { transform: rotate(-5deg); }
          70% { transform: rotate(0); }
          100% { transform: rotate(0); }
        }
        
        .animate-bounce-in {
          animation: bounce-in 0.6s ease-out forwards;
        }
        
        .animate-ring {
          animation: ring 1s ease-in-out infinite;
        }
      `}</style>
    </>
  );
};

export default CampaignReminderPopup;
