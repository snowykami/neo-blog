"use client";

import React, { useEffect, useState } from "react";

export default function Typewriter({
  text,
  speed = 30, // 每个字符的毫秒间隔
}: {
  text: string;
  speed?: number;
}) {
  const [index, setIndex] = useState(0);
  const [caretVisible, setCaretVisible] = useState(true);

  useEffect(() => {
    setIndex(0);
    if (!text) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= text.length) {
          clearInterval(t);
          return text.length;
        }
        return i + 1;
      });
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);

  useEffect(() => {
    const c = setInterval(() => setCaretVisible((v) => !v), 500);
    return () => clearInterval(c);
  }, []);

  return (
    <div style={{ whiteSpace: "pre-wrap" }}>
      {text.slice(0, index)}
      <span style={{ display: "inline-block", width: 10, textAlign: "left", visibility: caretVisible ? "visible" : "hidden" }}>
        |
      </span>
    </div>
  );
}