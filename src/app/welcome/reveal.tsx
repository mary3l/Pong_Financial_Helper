"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fades its section in as it scrolls into view. The text is in the HTML from
 * the start (search engines read it), and with reduced motion the CSS in
 * globals.css shows it straight away.
 */
export function Reveal({
  children,
  className = "",
  as: Tag = "section",
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement>}
      data-shown={shown}
      className={`reveal ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}
