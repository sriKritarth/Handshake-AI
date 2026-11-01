import type { SyntheticEvent } from 'react';

/**
 * Strict Cloudinary-Only Asset Pipeline (Zero Unsplash Policy)
 * Injects f_auto, q_auto, and width transforms into Cloudinary URLs.
 * Returns a clean semantic SVG data URI placeholder with item initials for missing or invalid images.
 */

const resolvedImageCache = new Map<string, string>();

export function getSvgPlaceholder(title = 'Item', width = 500, height = 400): string {
  const cleanTitle = (title || 'Item').trim();
  const initials = cleanTitle
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || 'HI';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f2f0e6"/>
    <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#dcded4" stroke-width="1"/>
    <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" font-family="Georgia, serif" font-size="${Math.round(
      width * 0.12
    )}" fill="#566446" font-weight="bold">${initials}</text>
    <text x="50%" y="62%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="${Math.max(
      11,
      Math.round(width * 0.028)
    )}" fill="#7c7a63" letter-spacing="1.5">VERIFIED INVENTORY</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getOptimizedImageUrl(
  url: string | null | undefined,
  width = 500,
  itemName = 'Item'
): string {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return getSvgPlaceholder(itemName, width);
  }

  let trimmed = url.trim();

  // Enforce HTTPS for Cloudinary secure URLs
  if (trimmed.startsWith('http://res.cloudinary.com')) {
    trimmed = trimmed.replace('http://res.cloudinary.com', 'https://res.cloudinary.com');
  }

  // Deprecate third-party Unsplash stock images
  if (trimmed.includes('unsplash.com')) {
    return getSvgPlaceholder(itemName, width);
  }

  const cacheKey = `${trimmed}_w${width}`;
  if (resolvedImageCache.has(cacheKey)) {
    return resolvedImageCache.get(cacheKey)!;
  }

  if (trimmed.includes('cloudinary.com')) {
    if (trimmed.includes('/upload/')) {
      const transform = `f_auto,q_auto,w_${width}`;
      const optimized = trimmed.replace('/upload/', `/upload/${transform}/`);
      resolvedImageCache.set(cacheKey, optimized);
      return optimized;
    }
    resolvedImageCache.set(cacheKey, trimmed);
    return trimmed;
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  // Fallback to SVG placeholder for non-Cloudinary arbitrary URLs
  return getSvgPlaceholder(itemName, width);
}

/**
 * ALGORITHM: HandleImageError(event, productName)
 * 1. Read failed image element target.
 * 2. Generate inline SVG placeholder: svgUrl = getSvgPlaceholder(productName).
 * 3. If target.src != svgUrl:
 *    - target.src = svgUrl.
 *    - Prevent infinite error looping.
 */
export function handleImageError(
  event: SyntheticEvent<HTMLImageElement, Event> | Event,
  productName = 'Item'
): void {
  // 1. Read failed image element target.
  const target = (event.currentTarget || event.target) as HTMLImageElement | null;
  if (!target) return;

  // 2. Generate inline SVG placeholder: svgUrl = getSvgPlaceholder(productName).
  const svgUrl = getSvgPlaceholder(productName);

  // 3. If target.src != svgUrl:
  if (target.src !== svgUrl) {
    // - target.src = svgUrl.
    target.src = svgUrl;
    // - Prevent infinite error looping.
    target.onerror = null;
  }
}
