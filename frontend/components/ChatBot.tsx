import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles, ChevronDown } from 'lucide-react';
import { useTheme, getThemeClasses } from '../context/ThemeContext';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const API_BASE_URL = 'http://localhost:5000/api';

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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isPersonalized, setIsPersonalized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for custom event to open chat with a message
  useEffect(() => {
    const handleOpenChatWithMessage = (event: CustomEvent<{ message: string; synopsis?: string; insights?: string[] }>) => {
      setIsOpen(true);
      setIsMinimized(false);
      
      // Add a small delay to ensure the chat is open, then send the message
      setTimeout(() => {
        const { message } = event.detail;
        if (message) {
          // Create user message
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: message,
            timestamp: new Date()
          };
          setMessages(prev => [...prev, userMessage]);
          
          // Send to API
          setIsLoading(true);
          const token = getToken();
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          fetch(`${API_BASE_URL}/chat/message`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message,
              conversationHistory: messages.slice(-10).map(m => ({
                role: m.role,
                content: m.content
              }))
            })
          })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                const assistantMessage: Message = {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: data.response,
                  timestamp: new Date()
                };
                setMessages(prev => [...prev, assistantMessage]);
                setIsPersonalized(data.personalized || false);
              }
            })
            .catch(console.error)
            .finally(() => setIsLoading(false));
        }
      }, 300);
    };

    window.addEventListener('openChatWithMessage', handleOpenChatWithMessage as EventListener);
    return () => {
      window.removeEventListener('openChatWithMessage', handleOpenChatWithMessage as EventListener);
    };
  }, [messages]);

  // Load suggestions on mount (with auth for personalization)
  useEffect(() => {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    fetch(`${API_BASE_URL}/chat/suggestions`, { headers })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setSuggestions(data.suggestions);
          setIsPersonalized(data.personalized || false);
        }
      })
      .catch(console.error);
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
      // Prepare conversation history for context
      const conversationHistory = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));

      // Include auth token for personalization
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/chat/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text,
          conversationHistory
        })
      });

      const data = await response.json();

      if (data.success) {
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, assistantMessage]);
        setIsPersonalized(data.personalized || false);
      } else {
        throw new Error(data.message || 'Failed to get response');
      }
    } catch (error: any) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm sorry, I couldn't process your request. Please try again.",
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

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
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
      <div className={`${theme.bgCard} rounded-2xl shadow-2xl border ${isDarkMode ? 'border-slate-700/50' : 'border-slate-200'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300 max-h-[500px]`}>
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
                        : `${theme.bgCard} ${theme.text} shadow-sm border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'} rounded-bl-md`
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              
              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className={`${theme.bgCard} px-4 py-3 rounded-2xl rounded-bl-md shadow-sm border ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'}`}>
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

            {/* Suggestions - show only if few messages */}
            {messages.length <= 2 && suggestions.length > 0 && (
              <div className={`px-4 py-2 ${theme.bgCard} border-t ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'}`}>
                <p className={`text-xs mb-2 ${theme.textMuted}`}>Suggested questions:</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 3).map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestionClick(suggestion)}
                      className={`text-xs px-2.5 py-1.5 ${isDarkMode ? 'bg-[#0d1117] text-[#ededed]/70' : 'bg-[#ededed] text-slate-600'} hover:bg-[#ffcc29]/20 hover:text-[#ffcc29] rounded-full transition-colors truncate max-w-full`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Input */}
            <div className={`p-3 ${theme.bgCard} border-t ${isDarkMode ? 'border-slate-700/50' : 'border-[#ededed]'}`}>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me anything..."
                  disabled={isLoading}
                  className={`flex-1 px-4 py-2.5 ${isDarkMode ? 'bg-[#070A12] text-[#ededed] placeholder-[#ededed]/50 border border-slate-700/50' : 'bg-[#f5f5f5] text-[#070A12] placeholder-gray-400 border border-gray-200'} rounded-full text-sm outline-none focus:ring-2 focus:ring-[#ffcc29] transition-all disabled:opacity-50`}
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
              <p className={`text-[10px] text-center mt-2 ${theme.textMuted}`}>
                {isPersonalized ? '✨ Personalized for your business' : 'Powered by Groq AI'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ChatBot;
