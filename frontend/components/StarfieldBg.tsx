import React, { useEffect, useRef } from 'react';

const StarfieldCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const stars = Array.from({ length: 220 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.5 + 0.3,
      speed: Math.random() * 0.15 + 0.02,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
    }));

    const shootingStars: {
      x: number;
      y: number;
      len: number;
      speed: number;
      opacity: number;
      angle: number;
    }[] = [];

    const maybeSpawn = () => {
      if (Math.random() < 0.003 && shootingStars.length < 2) {
        shootingStars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height * 0.4,
          len: Math.random() * 80 + 40,
          speed: Math.random() * 6 + 4,
          opacity: 1,
          angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const s of stars) {
        s.twinkle += s.twinkleSpeed;
        const alpha = 0.4 + Math.sin(s.twinkle) * 0.35;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 245, 225, ${alpha})`;
        ctx.fill();
        s.y += s.speed;
        if (s.y > canvas.height + 2) {
          s.y = -2;
          s.x = Math.random() * canvas.width;
        }
      }

      maybeSpawn();
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i];
        const dx = Math.cos(ss.angle) * ss.len;
        const dy = Math.sin(ss.angle) * ss.len;
        const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x - dx, ss.y - dy);
        grad.addColorStop(0, `rgba(255, 204, 41, ${ss.opacity})`);
        grad.addColorStop(1, 'rgba(255, 204, 41, 0)');
        ctx.beginPath();
        ctx.moveTo(ss.x, ss.y);
        ctx.lineTo(ss.x - dx, ss.y - dy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ss.x += Math.cos(ss.angle) * ss.speed;
        ss.y += Math.sin(ss.angle) * ss.speed;
        ss.opacity -= 0.008;
        if (ss.opacity <= 0) shootingStars.splice(i, 1);
      }

      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
};

export const SpaceBg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="min-h-screen relative overflow-hidden"
    style={{
      background:
        'radial-gradient(ellipse at 50% 0%, #0d1525 0%, #070a12 50%, #030507 100%)',
    }}
  >
    <StarfieldCanvas />
    <div className="absolute inset-0 pointer-events-none">
      <div
        className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] rounded-full opacity-[0.06]"
        style={{ background: 'radial-gradient(circle, #5b3cc4, transparent 70%)' }}
      />
      <div
        className="absolute top-[10%] right-[5%] w-[500px] h-[500px] rounded-full opacity-[0.04]"
        style={{ background: 'radial-gradient(circle, #ffcc29, transparent 70%)' }}
      />
      <div
        className="absolute bottom-[5%] left-[10%] w-[700px] h-[500px] rounded-full opacity-[0.03]"
        style={{ background: 'radial-gradient(circle, #1e6091, transparent 65%)' }}
      />
      <div
        className="absolute bottom-[-15%] right-[20%] w-[550px] h-[550px] rounded-full opacity-[0.04]"
        style={{ background: 'radial-gradient(circle, #8b3a62, transparent 70%)' }}
      />
    </div>
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'radial-gradient(ellipse at center, transparent 40%, rgba(3,5,7,0.7) 100%)',
      }}
    />
    <div className="relative z-10 flex items-start justify-center min-h-screen p-4 md:p-8 py-12">
      {children}
    </div>
  </div>
);

export const GlassCard: React.FC<{
  children: React.ReactNode;
  highlighted?: boolean;
  className?: string;
}> = ({ children, highlighted, className = '' }) => (
  <div
    className={`
      relative rounded-3xl p-[1px] transition-all duration-500
      ${
        highlighted
          ? 'bg-gradient-to-b from-[#ffcc29]/50 via-[#ffcc29]/15 to-transparent shadow-2xl shadow-[#ffcc29]/10'
          : 'bg-gradient-to-b from-white/10 via-white/5 to-transparent'
      }
      ${className}
    `}
  >
    <div
      className={`
        rounded-3xl h-full
        ${
          highlighted
            ? 'bg-gradient-to-b from-[#0f1520]/90 via-[#0a0e18]/95 to-[#060910]/95'
            : 'bg-gradient-to-b from-[#0d1219]/85 via-[#080c14]/90 to-[#060910]/90'
        }
        backdrop-blur-xl
      `}
    >
      {children}
    </div>
  </div>
);
