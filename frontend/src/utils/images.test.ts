import { describe, it, expect } from 'vitest';
import { getOptimizedImageUrl, getSvgPlaceholder, handleImageError } from './images';
import { normalizeCatalogSku } from '../api/schemas';

describe('Strict Cloudinary Asset Pipeline & Secure URL Mapping', () => {
  it('injects f_auto,q_auto and width into valid Cloudinary URLs', () => {
    const input = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';
    const output = getOptimizedImageUrl(input, 500, 'Handmade Vase');
    expect(output).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_500/sample.jpg');
  });

  it('enforces HTTPS on insecure Cloudinary URLs', () => {
    const input = 'http://res.cloudinary.com/v6jfwkvc/image/upload/v12345/sample.jpg';
    const output = getOptimizedImageUrl(input, 600, 'Sample Item');
    expect(output).toContain('https://res.cloudinary.com/');
    expect(output).toContain('w_600');
  });

  it('rejects external Unsplash URLs and returns an SVG placeholder', () => {
    const input = 'https://images.unsplash.com/photo-123456789';
    const output = getOptimizedImageUrl(input, 500, 'Ceramic Pitcher');
    expect(output).toContain('data:image/svg+xml;utf8');
    expect(output).toContain('CP'); // Initials of Ceramic Pitcher
    expect(output).toContain('VERIFIED%20INVENTORY');
  });

  it('returns clean SVG placeholder for null, undefined, or empty string', () => {
    const outputNull = getOptimizedImageUrl(null, 400, 'Solid Oak Chair');
    expect(outputNull).toContain('data:image/svg+xml;utf8');
    expect(outputNull).toContain('SO');

    const outputEmpty = getOptimizedImageUrl('   ', 400, 'Linen Tablecloth');
    expect(outputEmpty).toContain('data:image/svg+xml;utf8');
    expect(outputEmpty).toContain('LT');
  });

  it('generates correct SVG placeholder with proper dimensions and initials', () => {
    const placeholder = getSvgPlaceholder('Walnut Desk Lamp', 600, 450);
    expect(placeholder).toContain('width%3D%22600%22');
    expect(placeholder).toContain('WD');
  });
});

describe('Catalog Sku Normalizer (response.secure_url defense)', () => {
  it('normalizes response.secure_url into Image_url, image_url, and secure_url', () => {
    const raw = {
      sku_code: 'SKU-CASHEW-W240',
      name: 'Cashew W240 Bulk',
      category: 'Food & Pantry',
      base_price: 850,
      secure_url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/cashew.jpg',
    };

    const normalized = normalizeCatalogSku(raw);
    expect(normalized.sku_code).toBe('SKU-CASHEW-W240');
    expect(normalized.secure_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/cashew.jpg');
    expect(normalized.Image_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/cashew.jpg');
    expect(normalized.image_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/cashew.jpg');
  });

  it('normalizes backend database Image_url casing to all fields', () => {
    const raw = {
      sku_code: 'SKU-002',
      name: 'Artisan Bowl',
      base_price: 1200,
      Image_url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/bowl.jpg',
    };

    const normalized = normalizeCatalogSku(raw);
    expect(normalized.secure_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/bowl.jpg');
    expect(normalized.Image_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/bowl.jpg');
    expect(normalized.image_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/bowl.jpg');
  });

  it('handles nested image.secure_url structure', () => {
    const raw = {
      sku_code: 'SKU-003',
      name: 'Leather Notebook',
      base_price: 450,
      image: {
        secure_url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/notebook.jpg',
      },
    };

    const normalized = normalizeCatalogSku(raw);
    expect(normalized.secure_url).toBe('https://res.cloudinary.com/v6jfwkvc/image/upload/notebook.jpg');
  });
});

describe('ALGORITHM: HandleImageError', () => {
  it('replaces failed image src with inline SVG placeholder', () => {
    const imgElement = document.createElement('img');
    imgElement.src = 'https://broken-image.com/not-found.jpg';

    const mockEvent = {
      target: imgElement,
      currentTarget: imgElement,
    } as any;

    handleImageError(mockEvent, 'Cashew W240');

    expect(imgElement.src).toContain('data:image/svg+xml;utf8');
    expect(imgElement.src).toContain('CW');
    expect(imgElement.onerror).toBeNull();
  });

  it('prevents infinite error looping if SVG placeholder triggers error', () => {
    const imgElement = document.createElement('img');
    const svgUrl = getSvgPlaceholder('Rustic Table');
    imgElement.src = svgUrl;

    const mockEvent = {
      target: imgElement,
      currentTarget: imgElement,
    } as any;

    // Call again with same svgUrl
    handleImageError(mockEvent, 'Rustic Table');

    // Should not re-set src or trigger loops
    expect(imgElement.src).toBe(svgUrl);
  });
});
