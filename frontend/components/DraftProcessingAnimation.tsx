import React from 'react';
import { Sparkles, Cpu } from 'lucide-react';

interface DraftProcessingAnimationProps {
  step?: string;
  progress?: number;
  type?: 'reel' | 'post' | 'campaign' | string;
}

export const DraftProcessingAnimation: React.FC<DraftProcessingAnimationProps> = ({ step, progress, type = 'post' }) => {
  return (
    <div className="absolute inset-0 bg-slate-950 overflow-hidden flex flex-col items-center justify-center p-4">
      {/* Background Pulse */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-[#ffcc29]/10 animate-pulse" />
      
      {/* Scanner Line */}
      <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#ffcc29]/50 to-transparent shadow-[0_0_15px_rgba(255,204,41,0.5)] animate-[scan_2s_ease-in-out_infinite]" style={{ animationName: 'scan', animationDuration: '2.5s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' }} />

      {/* Center Icon */}
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-[#ffcc29]/20 blur-xl rounded-full animate-pulse" />
        <div className="relative w-12 h-12 bg-slate-900 rounded-full border border-[#ffcc29]/30 flex items-center justify-center shadow-[0_0_15px_rgba(255,204,41,0.2)]">
          <Cpu className="w-6 h-6 text-[#ffcc29] animate-pulse" />
          <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-emerald-400 animate-ping" />
        </div>
      </div>

      {/* Text */}
      <div className="relative z-10 text-center space-y-2 w-full max-w-[85%]">
        <h4 className="text-[10px] sm:text-xs font-bold text-slate-300 tracking-wider uppercase">
          AI {type} Engine
        </h4>
        <p className="text-[10px] sm:text-xs text-[#ffcc29] font-medium line-clamp-2 h-8 flex items-center justify-center">
          {step || 'Synthesizing content...'}
        </p>
        
        {/* Progress Bar */}
        {typeof progress === 'number' && progress > 0 && (
          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden border border-slate-700/50">
            <div 
              className="bg-gradient-to-r from-emerald-500 to-[#ffcc29] h-full transition-all duration-500 ease-out relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute top-0 right-0 bottom-0 w-10 bg-white/20 blur-[2px]" style={{ animationName: 'shimmer', animationDuration: '1s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' }} />
            </div>
          </div>
        )}
      </div>
      
      {/* Custom Keyframes injected safely */}
      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(150%); }
        }
      `}</style>
    </div>
  );
};
