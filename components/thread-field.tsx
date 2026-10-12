'use client';
/*
 * ThreadField — the landing's decorative background, built on the adapted React Bits Threads
 * renderer (components/threads.tsx). This file owns composition only: which Threads settings
 * apply at which width, the static fallback when WebGL is unavailable, and the motion control.
 *
 * Decorative throughout: every layer is aria-hidden and pointer-events:none (app/globals.css),
 * so nothing here enters the accessibility tree or intercepts a control.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Play } from 'lucide-react';
import Threads, { type ThreadsProps, type ThreadsStatus } from './threads';

const FOREST = '#023527';
const SAGE = '#478f81';

/* Media queries through useSyncExternalStore: the server snapshot is `false`, so hydration
   matches the server markup and the real value applies on the first client commit. */
function subscribe(query: string) {
  return (notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  };
}
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    useMemo(() => subscribe(query), [query]),
    () => window.matchMedia(query).matches,
    () => false
  );
}
const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

type Setting = Omit<ThreadsProps, 'paused' | 'onStatus' | 'className'>;
type Variant = 'hero' | 'closing';

/* Tuned against the running page; the reasoning for each value is recorded in
   design/threads-background.md. Two compositions per variant: the two-column layout above
   1080px, and the stacked single column below it (phones included). */
const SETTINGS: Record<Variant, { wide: Setting; stacked: Setting }> = {
  hero: {
    wide: {
      color: FOREST, accentColor: SAGE, lineCount: 44, thickness: 1.4, softness: 0.6,
      amplitude: 2.7, distance: 0.34, waves: 0.85, speed: 0.95, split: 0.05, fray: 0.7,
      angle: 18, taper: 0.55, brightness: 1.35, seed: 4
    },
    stacked: {
      color: FOREST, accentColor: SAGE, lineCount: 24, thickness: 1.1, softness: 0.2,
      amplitude: 2.8, distance: 0.9, waves: 0.7, speed: 0.95, split: 0.05, fray: 0.8,
      angle: -10, taper: 0.45, brightness: 1.35, seed: 4
    }
  },
  closing: {
    wide: {
      color: FOREST, accentColor: SAGE, lineCount: 26, thickness: 1.3, softness: 0.6,
      amplitude: 4.2, distance: 0.55, waves: 0.8, speed: 0.95, split: 0.08, fray: 0.7,
      angle: 184, taper: 0.55, brightness: 1.3, seed: 9
    },
    stacked: {
      color: FOREST, accentColor: SAGE, lineCount: 20, thickness: 1.1, softness: 0.2,
      amplitude: 2.6, distance: 0.8, waves: 0.7, speed: 0.95, split: 0.08, fray: 0.7,
      angle: 184, taper: 0.5, brightness: 1.3, seed: 9
    }
  }
};

/* The composed still used when WebGL2 is unavailable or the renderer fails: the same reading as
   the live field, drawn once. Each strand leaves a shared bundle, separates progressively and
   carries a slow wave whose phase differs per strand, so strands cross, gather and part; outer
   strands are lighter and thinner, as the shader's taper makes them. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function strandPath(variant: Variant, t: number): string {
  const points: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    const x = variant === 'hero' ? -40 + u * 1080 : 1040 - u * 1080;
    const apart = smooth(0.12, 0.85, u);
    const wave = Math.sin(u * 7.5 + t * 3.1) * (variant === 'hero' ? 70 : 34) * apart;
    const y = variant === 'hero'
      ? 700 - u * 600 + (t - 0.5) * 420 * apart + wave
      : 160 + (t - 0.5) * 200 * apart + wave;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}
function StillThreads({ variant }: { variant: Variant }) {
  const n = variant === 'hero' ? 26 : 16;
  return (
    <svg className="field-still" viewBox={variant === 'hero' ? '0 0 1000 700' : '0 0 1000 300'} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {Array.from({ length: n }, (_, i) => {
        const t = i / (n - 1);
        return <path key={i} d={strandPath(variant, t)} fill="none" stroke={t < 0.5 ? FOREST : SAGE}
          strokeOpacity={1 - Math.abs(t - 0.5) * 1.1} strokeWidth={1.3 - Math.abs(t - 0.5)} vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

export default function ThreadField({ variant, paused, onStatus, clearAfter }: {
  variant: Variant;
  paused: boolean;
  onStatus?: (status: ThreadsStatus) => void;
  /** Selector, inside the same section, for the last element of the reading zone. Its bottom
      edge is published as --field-clear (px from the section top) for the stacked mask. */
  clearAfter?: string;
}) {
  const stacked = useMedia('(max-width: 1080px)');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const field = ref.current, section = field?.parentElement;
    const anchor = clearAfter ? section?.querySelector<HTMLElement>(clearAfter) : null;
    if (!field || !section || !anchor) return undefined;
    const measure = () => {
      const top = section.getBoundingClientRect().top;
      field.style.setProperty('--field-clear', `${Math.round(anchor.getBoundingClientRect().bottom - top)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    observer.observe(anchor);
    measure();
    return () => observer.disconnect();
  }, [clearAfter]);
  const [status, setStatus] = useState<ThreadsStatus | null>(null);
  const report = useCallback((s: ThreadsStatus) => {
    setStatus(s);
    onStatus?.(s);
  }, [onStatus]);
  const setting = SETTINGS[variant][stacked ? 'stacked' : 'wide'];
  return (
    <div ref={ref} className={`field field-${variant}`} data-ready={status ? 'true' : undefined} aria-hidden="true">
      {status === 'failed'
        ? <StillThreads variant={variant} />
        : <Threads {...setting} paused={paused} onStatus={report} />}
    </div>
  );
}

/* One quiet control for every field on the page. Hidden when the system asks for reduced
   motion (nothing animates, so there is nothing to pause) and when the renderer failed. */
export function MotionToggle({ paused, onToggle, available }: {
  paused: boolean;
  onToggle: () => void;
  available: boolean;
}) {
  const reduced = useReducedMotion();
  if (reduced || !available) return null;
  return (
    <button type="button" className="motion-toggle" onClick={onToggle}>
      {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      {paused ? 'Resume background motion' : 'Pause background motion'}
    </button>
  );
}
