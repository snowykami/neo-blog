"use client";

import { motion } from "motion/react";

export function WaveEffects() {
  return (
    <section className="absolute left-0 w-full z-0" style={{ bottom: '-11px' }}>
      <svg
        className="w-full h-16 md:h-16" // height: 4rem = h-16
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 24 150 28"
        preserveAspectRatio="none"
        shapeRendering="auto"
      >
        <defs>
          <path
            id="gentle-wave"
            d="M -160 44 c 30 0 58 -18 88 -18 s 58 18 88 18 s 58 -18 88 -18 s 58 18 88 18 v 44 h -352 Z"
          />
        </defs>
        <g className="parallax">
          <use
            href="#gentle-wave"
            x="48"
            y="0"
            className="fill-background/20 animate-wave-1"
          />
          <use
            href="#gentle-wave"
            x="48"
            y="0"
            className="fill-primary/20 animate-wave-1"
          />

          <use
            href="#gentle-wave"
            x="48"
            y="3"
            className="fill-background/50 animate-wave-2"
          />
          <use
            href="#gentle-wave"
            x="48"
            y="3"
            className="fill-primary/20 animate-wave-2"
          />

          <use
            href="#gentle-wave"
            x="48"
            y="5"
            className="fill-background/70 animate-wave-3"
          />
          <use
            href="#gentle-wave"
            x="48"
            y="5"
            className="fill-primary/20 animate-wave-3"
          />

          <use
            href="#gentle-wave"
            x="48"
            y="7"
            className="fill-background animate-wave-3"
          />
          <use
            href="#gentle-wave"
            x="48"
            y="7"
            className="fill-primary/20 animate-wave-3"
          />
        </g>
      </svg>

      <style jsx>{`
        .animate-wave-1 {
          animation: wave-move 7s cubic-bezier(0.55, 0.5, 0.45, 0.5) infinite;
          animation-delay: -2s;
        }
        .animate-wave-2 {
          animation: wave-move 10s cubic-bezier(0.55, 0.5, 0.45, 0.5) infinite;
          animation-delay: -3s;
        }
        .animate-wave-3 {
          animation: wave-move 13s cubic-bezier(0.55, 0.5, 0.45, 0.5) infinite;
          animation-delay: -4s;
        }
        .animate-wave-4 {
          animation: wave-move 20s cubic-bezier(0.55, 0.5, 0.45, 0.5) infinite;
          animation-delay: -5s;
        }
        
        @keyframes wave-move {
          0% { transform: translate3d(-90px, 0, 0); }
          100% { transform: translate3d(85px, 0, 0); }
        }
      `}</style>
    </section>
  );
}