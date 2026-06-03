"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

type LazyImageProps = {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
};

export function LazyImage({ src, alt, className = "", priority = false }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span className={`lazy-image ${loaded ? "is-loaded" : ""} ${failed ? "is-failed" : ""} ${className}`}>
      <span className={`lazy-image__placeholder ${failed ? "" : "skeleton"}`} aria-hidden />
      <img
        alt={alt}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        src={src}
      />
    </span>
  );
}
