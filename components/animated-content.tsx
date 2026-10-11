'use client';
/*
 * AnimatedContent — adapted for LC Rescue Desk.
 *
 * Source:   React Bits — src/ts-default/Animations/AnimatedContent/AnimatedContent.tsx
 *           https://github.com/DavidHDev/react-bits
 * Revision: 1eeb6f105c68b964289d85dabbe84a1d551f3797 (2026-09-27, "docs improvements")
 * Licence:  MIT + Commons Clause License Condition v1.0 — Copyright (c) 2026 David Haz.
 *           Permission is granted to use, copy, modify, merge, publish and distribute the
 *           Software as part of an application, website or product, provided this notice is
 *           retained. Commons Clause: the components themselves may not be sold, sublicensed
 *           or redistributed, alone, bundled, or as a ported version. Provided "as is",
 *           without warranty of any kind.
 *
 * Animation engine: GSAP 3.15.0, Standard "no charge" licence — https://gsap.com/standard-license
 *
 * Changes from the source revision, all deliberate:
 *   1. `distance` default 100 -> 12. Restrained travel suited to this layout.
 *   2. Removed the permanent `style={{visibility:'hidden'}}`. The element's resting markup is
 *      its final appearance, so content stays readable if JS never runs, fails, or is disabled.
 *   3. Added reduced-motion handling: with `prefers-reduced-motion: reduce` nothing is set and
 *      nothing animates; the element simply renders in its final state.
 *   4. Cleanup via `gsap.context().revert()`, which kills every tween the effect created and
 *      restores the inline styles it wrote. The source leaked the `disappearAfter` tween.
 *   5. Runs exactly once per mounted element: the dependency list is empty, so re-renders —
 *      including those from a background case refresh — cannot replay the entrance. The source
 *      listed `onComplete` in its deps, so an inline callback replayed the animation. Note that
 *      a `played` ref must NOT be used here: React StrictMode mounts, cleans up and remounts, so
 *      a ref that survives `ctx.revert()` makes the second pass bail out and strands the element
 *      in its pre-animation state. `ctx.revert()` already makes a repeat pass idempotent.
 *   6. Dropped ScrollTrigger. This composes an on-load sequence above the fold, so a scroll
 *      trigger would be inert, and it avoids a second plugin governing the same elements.
 *   7. Dropped `disappearAfter` / `disappearDuration` / `disappearEase` / `onDisappearanceComplete`.
 *      Nothing on this surface should animate away.
 *   8. `animateOpacity={false}` leaves text at full opacity for the whole tween, so evidence
 *      stays readable from the first frame.
 */
import { useEffect,useRef } from 'react';
import { gsap } from 'gsap';

type Props = React.HTMLAttributes<HTMLDivElement> & {
 children:React.ReactNode;
 /** Travel distance in px. Keep this small; this layout uses 8–14. */
 distance?:number;
 direction?:'vertical'|'horizontal';
 reverse?:boolean;
 duration?:number;
 ease?:string;
 /** When false the element never drops below full opacity, so text stays readable throughout. */
 animateOpacity?:boolean;
 initialOpacity?:number;
 delay?:number;
};

export default function AnimatedContent({
 children,distance=12,direction='vertical',reverse=false,duration=.55,ease='power2.out',
 animateOpacity=true,initialOpacity=0,delay=0,className,style,...rest
}:Props){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const el=ref.current;
  if(!el||typeof window==='undefined')return;
  // Respect the user's motion preference: leave the element exactly as rendered.
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const axis=direction==='horizontal'?'x':'y';
  const ctx=gsap.context(()=>{
   gsap.fromTo(el,
    {[axis]:reverse?-distance:distance,opacity:animateOpacity?initialOpacity:1},
    {[axis]:0,opacity:1,duration,ease,delay,clearProps:'transform,opacity'});
  },el);
  return ()=>ctx.revert();
  // Intentionally empty: this entrance plays once for the lifetime of the element.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 return <div ref={ref} className={className} style={style} {...rest}>{children}</div>;
}
