import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

interface StatCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  sub?: string;
  icon?: React.ReactNode;
  decimals?: number;
}

export function StatCard({ label, value, prefix = '', suffix = '', sub, icon, decimals = 0 }: StatCardProps) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started.current) {
            started.current = true;
            const duration = 900;
            const start = performance.now();
            function tick(now: number) {
              const p = Math.min((now - start) / duration, 1);
              const eased = 1 - Math.pow(1 - p, 3);
              setDisplay(value * eased);
              if (p < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
          }
        });
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <motion.div ref={ref} className="stat-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div className="stat-label">
        <span>{label}</span>
        {icon}
      </div>
      <div className="stat-value">
        {prefix}
        {display.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}
        {suffix}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </motion.div>
  );
}
