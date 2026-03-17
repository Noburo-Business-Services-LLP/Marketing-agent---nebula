import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5000/api';

// Helper to get auth token
const getToken = (): string | null => localStorage.getItem('authToken');

const ChatBot: React.FC = () => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hey there! 👋 I'm Daddy, your marketing assistant. How can I help you crush it today?",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for custom event to open chat with a message
  useEffect(() => {
    const handleOpenChatWithMessage = (event: CustomEvent<{ message: string; synopsis?: string; insights?: string[] }>) => {
      setIsOpen(true);
      setIsMinimized(false);
      
      // Add a small delay to ensure the chat is open, then prefill the input.
      // IMPORTANT: Do not auto-send (support email should only send on user submit).
      setTimeout(() => {
        const { message } = event.detail;
        if (message) {
          setInputValue(message);
          inputRef.current?.focus();
        }
      }, 300);
    };

    window.addEventListener('openChatWithMessage', handleOpenChatWithMessage as EventListener);
    return () => {
      window.removeEventListener('openChatWithMessage', handleOpenChatWithMessage as EventListener);
    };
  }, []);

  // Load current user details (to include name/email in support email)
  useEffect(() => {
    if (!isOpen) return;
    const token = getToken();
    if (!token) return;

    fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.success && data.user) {
          const name = `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim() || data.user.companyName || '';
          const email = data.user.email || '';
          if (name) setUserName(name);
          if (email) setUserEmail(email);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const sendMessage = async (messageText?: string) => {
    const text = messageText || inputValue.trim();
    if (!text || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/support/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: userName,
          email: userEmail,
          message: text
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Your query has been sent to our support team. We will contact you soon.',
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(data.message || 'Failed to send query');
      }
    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Failed to send query. Please try again later.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Closed state - just the floating button
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#ffcc29] rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group hover:scale-105"
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6 text-[#070A12]" />
        {/* Pulse animation */}
        <span className="absolute w-full h-full rounded-full bg-[#ffcc29] animate-ping opacity-25"></span>
        {/* Tooltip */}
        <span className="absolute right-full mr-3 px-3 py-1.5 bg-[#070A12] text-white text-sm rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
          Chat with Daddy
        </span>
      </button>
    );
  }

  return (
    <div 
      className={`fixed bottom-6 right-6 z-50 transition-all duration-300 ${
        isMinimized ? 'w-72' : 'w-96'
      }`}
    >
      {/* Chat Window */}
      <div className={`${theme.bgCard} rounded-2xl shadow-2xl border ${isDarkMode ? 'border-[#ffcc29]/20' : 'border-slate-200'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300 max-h-[500px]`}>
        {/* Header - Sticky */}
        <div className="bg-[#ffcc29] px-4 py-3 flex items-center justify-between sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#070A12]/20 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#070A12]" />
            </div>
            <div>
              <h3 className="text-[#070A12] font-bold text-sm">Daddy</h3>
              <p className="text-[#070A12]/70 text-xs">Your Marketing Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMinimized(!isMinimized)}
              className="w-8 h-8 flex items-center justify-center bg-[#070A12]/10 hover:bg-[#070A12]/30 rounded-lg transition-colors"
              aria-label={isMinimized ? 'Expand' : 'Minimize'}
            >
              <ChevronDown className={`w-5 h-5 text-[#070A12] transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 flex items-center justify-center bg-[#070A12]/10 hover:bg-red-500 hover:text-white rounded-lg transition-colors group"
              aria-label="Close chat"
            >
              <X className="w-5 h-5 text-[#070A12] group-hover:text-white" />
            </button>
          </div>
        </div>

        {/* Chat Content - hidden when minimized */}
        {!isMinimized && (
          <>
            {/* Messages */}
            <div className={`flex-1 h-80 overflow-y-auto p-4 space-y-4 ${isDarkMode ? 'bg-[#070A12]' : 'bg-[#f5f5f5]'}`}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                      message.role === 'user'
                        ? 'bg-[#ffcc29] text-[#070A12] font-medium rounded-br-md'
                        : `${theme.bgCard} ${theme.text} shadow-sm border ${isDarkMode ? 'border-[#ffcc29]/20' : 'border-[#ededed]'} rounded-bl-md`
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              
              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className={`${theme.bgCard} px-4 py-3 rounded-2xl rounded-bl-md shadow-sm border ${isDarkMode ? 'border-[#ffcc29]/20' : 'border-[#ededed]'}`}>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-[#ffcc29] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-2 h-2 bg-[#ffcc29] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-2 h-2 bg-[#ffcc29] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className={`p-3 ${theme.bgCard} border-t ${isDarkMode ? 'border-[#ffcc29]/20' : 'border-[#ededed]'}`}>
              {(!userName || !userEmail) && (
                <div className="mb-2 grid grid-cols-1 gap-2">
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Your name"
                    disabled={isLoading}
                    className={`w-full px-4 py-2.5 ${isDarkMode ? 'bg-[#070A12] text-[#ededed] placeholder-[#ededed]/50 border border-[#ffcc29]/20' : 'bg-[#f5f5f5] text-[#070A12] placeholder-gray-400 border border-gray-200'} rounded-full text-sm outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all disabled:opacity-50`}
                  />
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="Your email"
                    disabled={isLoading}
                    className={`w-full px-4 py-2.5 ${isDarkMode ? 'bg-[#070A12] text-[#ededed] placeholder-[#ededed]/50 border border-[#ffcc29]/20' : 'bg-[#f5f5f5] text-[#070A12] placeholder-gray-400 border border-gray-200'} rounded-full text-sm outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all disabled:opacity-50`}
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me anything..."
                  disabled={isLoading}
                  className={`flex-1 px-4 py-2.5 ${isDarkMode ? 'bg-[#070A12] text-[#ededed] placeholder-[#ededed]/50 border border-[#ffcc29]/20' : 'bg-[#f5f5f5] text-[#070A12] placeholder-gray-400 border border-gray-200'} rounded-full text-sm outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all disabled:opacity-50`}
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!inputValue.trim() || isLoading}
                  className="w-10 h-10 bg-[#ffcc29] hover:bg-[#e6b825] disabled:opacity-50 disabled:cursor-not-allowed rounded-full flex items-center justify-center transition-colors"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 text-[#070A12] animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 text-[#070A12]" />
                  )}
                </button>
              </div>
              <p className={`text-[10px] text-center mt-2 ${theme.textMuted}`}>Support</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatBot;
