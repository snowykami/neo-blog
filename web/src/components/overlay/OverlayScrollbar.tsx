import React, { useEffect, useRef, useState } from "react";
import styles from "./overlay-scrollbar.module.css";

export default function OverlayScrollbar({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [thumbTop, setThumbTop] = useState(0);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startScrollTop = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const visible = el.clientHeight;
      const total = el.scrollHeight;
      const ratio = visible / Math.max(total, 1);
      const h = Math.max(ratio * visible, 24);
      const top = total > visible ? (el.scrollTop / (total - visible)) * (visible - h) : 0;
      setThumbHeight(h);
      setThumbTop(isFinite(top) ? top : 0);

      if (thumbRef.current) {
        const percent = total > visible ? Math.round((el.scrollTop / (total - visible)) * 100) : 0;
        thumbRef.current.setAttribute("aria-valuenow", String(percent));
      }
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const obs = new MutationObserver(update);
    obs.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !scrollRef.current) return;
      const el = scrollRef.current;
      const visible = el.clientHeight;
      const total = el.scrollHeight;
      const h = thumbHeight;
      const delta = e.clientY - startY.current;
      const proportion = delta / Math.max(visible - h, 1);
      el.scrollTop = Math.min(Math.max(startScrollTop.current + proportion * (total - visible), 0), total - visible);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [thumbHeight]);

  const onThumbMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    if (scrollRef.current) startScrollTop.current = scrollRef.current.scrollTop;
    document.body.style.userSelect = "none";
  };

  return (
    <div className={`${styles.container} ${className || ""}`} style={{ position: "relative", ...style }}>
      <div ref={scrollRef} className={styles.content} tabIndex={0}>
        {children}
      </div>

      <div className={styles.track} aria-hidden={false}>
        <div
          ref={thumbRef}
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          className={styles.thumb}
          style={{ height: thumbHeight, transform: `translateY(${thumbTop}px)` }}
          onMouseDown={onThumbMouseDown}
        />
      </div>
    </div>
  );
}
