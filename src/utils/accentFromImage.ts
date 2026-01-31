/**
 * Extract a dominant accent color from an image URL and apply it as --accent.
 * Uses canvas to sample the image (requires CORS on the image host).
 */

import { useEffect } from 'react';

const DEFAULT_ACCENT = '#58a6ff';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToChannel(p, q, h + 1 / 3);
    g = hueToChannel(p, q, h);
    b = hueToChannel(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueToChannel(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
}

/**
 * Load image, sample on canvas, return dominant color as hex.
 * Keeps hue from image; uses fixed saturation/lightness for a visible accent.
 */
export function extractAccentFromImageUrl(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const size = 32;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(DEFAULT_ACCENT);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          const [h, , l] = rgbToHsl(pr, pg, pb);
          if (l < 0.15 || l > 0.92) continue;
          r += pr;
          g += pg;
          b += pb;
          count++;
        }
        if (count === 0) {
          resolve(DEFAULT_ACCENT);
          return;
        }
        r /= count;
        g /= count;
        b /= count;
        const [h, , l] = rgbToHsl(r, g, b);
        const [rr, gg, bb] = hslToRgb(h, 0.65, 0.6);
        resolve(rgbToHex(rr, gg, bb));
      } catch {
        resolve(DEFAULT_ACCENT);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageUrl;
  });
}

export function getDefaultAccent(): string {
  return DEFAULT_ACCENT;
}

/**
 * When imageUrl changes, extract a dominant color from the image and set --accent.
 * Resets to default on unmount or when extraction fails (e.g. CORS).
 */
export function useAccentFromImage(imageUrl: string | null): void {
  useEffect(() => {
    if (!imageUrl) {
      document.documentElement.style.setProperty('--accent', DEFAULT_ACCENT);
      return;
    }
    let cancelled = false;
    extractAccentFromImageUrl(imageUrl)
      .then((hex) => {
        if (!cancelled) {
          document.documentElement.style.setProperty('--accent', hex);
        }
      })
      .catch(() => {
        if (!cancelled) {
          document.documentElement.style.setProperty('--accent', DEFAULT_ACCENT);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);
}
