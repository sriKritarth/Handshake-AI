import { describe, it, expect } from 'vitest';
import { normalizeCatalogSku, CatalogSku } from './schemas';
import { formatPrice } from './client';

describe('ALGORITHM: TestSchemaEdgeCases()', () => {
  // 1. Test null, undefined, empty string, raw number as raw payload.
  // - ASSERT returns safe default object without throwing TypeError.
  it('1. Returns safe default object without throwing TypeError on null, undefined, empty string, raw number', () => {
    const defaultStructure = (item: CatalogSku) => {
      expect(item).toBeDefined();
      expect(typeof item.sku_code).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(typeof item.category).toBe('string');
      expect(typeof item.base_price).toBe('number');
      expect(item.base_price).toBe(0);
      expect(item.Image_url).toBeNull();
    };

    // null payload
    expect(() => defaultStructure(normalizeCatalogSku(null))).not.toThrow();

    // undefined payload
    expect(() => defaultStructure(normalizeCatalogSku(undefined))).not.toThrow();

    // empty string payload
    expect(() => defaultStructure(normalizeCatalogSku(''))).not.toThrow();

    // raw number payload
    expect(() => defaultStructure(normalizeCatalogSku(42))).not.toThrow();

    // boolean payload
    expect(() => defaultStructure(normalizeCatalogSku(true))).not.toThrow();
  });

  // 2. Test Image URL variations:
  // - Provide { secure_url }, { Image_url }, { image_url }, { imageUrl }, { image: { url } }.
  // - ASSERT all resolve to expected HTTPS Cloudinary URL.
  it('2. Resolves all image URL variations to expected HTTPS Cloudinary URL', () => {
    const expected = 'https://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg';

    // Variation A: { secure_url }
    const fromSecureUrl = normalizeCatalogSku({
      sku_code: 'SKU-1',
      name: 'Item 1',
      secure_url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg',
    });
    expect(fromSecureUrl.secure_url).toBe(expected);
    expect(fromSecureUrl.Image_url).toBe(expected);
    expect(fromSecureUrl.image_url).toBe(expected);

    // Variation B: { Image_url } (with insecure HTTP upgrade check)
    const fromImageUrl = normalizeCatalogSku({
      sku_code: 'SKU-2',
      name: 'Item 2',
      Image_url: 'http://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg',
    });
    expect(fromImageUrl.secure_url).toBe(expected);
    expect(fromImageUrl.Image_url).toBe(expected);

    // Variation C: { image_url }
    const fromLowercaseImageUrl = normalizeCatalogSku({
      sku_code: 'SKU-3',
      name: 'Item 3',
      image_url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg',
    });
    expect(fromLowercaseImageUrl.secure_url).toBe(expected);

    // Variation D: { imageUrl } (camelCase)
    const fromCamelImageUrl = normalizeCatalogSku({
      sku_code: 'SKU-4',
      name: 'Item 4',
      imageUrl: 'https://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg',
    });
    expect(fromCamelImageUrl.secure_url).toBe(expected);

    // Variation E: { image: { url } }
    const fromNestedImageUrl = normalizeCatalogSku({
      sku_code: 'SKU-5',
      name: 'Item 5',
      image: {
        url: 'https://res.cloudinary.com/v6jfwkvc/image/upload/sample.jpg',
      },
    });
    expect(fromNestedImageUrl.secure_url).toBe(expected);
  });

  // 3. Test Price variations:
  // - Provide "450", null, undefined, "not-a-number".
  // - ASSERT base_price is valid numeric value and formatPrice never outputs "NaN".
  it('3. Guarantees base_price is numeric and formatPrice never outputs "NaN"', () => {
    // Variation A: string number "450"
    const p1 = normalizeCatalogSku({ sku_code: 'P-1', name: 'P1', base_price: '450' });
    expect(p1.base_price).toBe(450);
    expect(formatPrice(p1.base_price)).toBe('₹450');
    expect(formatPrice(p1.base_price)).not.toContain('NaN');

    // Variation B: null
    const p2 = normalizeCatalogSku({ sku_code: 'P-2', name: 'P2', base_price: null });
    expect(p2.base_price).toBe(0);
    expect(formatPrice(p2.base_price)).toBe('₹0');
    expect(formatPrice(p2.base_price)).not.toContain('NaN');

    // Variation C: undefined
    const p3 = normalizeCatalogSku({ sku_code: 'P-3', name: 'P3', base_price: undefined });
    expect(p3.base_price).toBe(0);
    expect(formatPrice(p3.base_price)).toBe('₹0');
    expect(formatPrice(p3.base_price)).not.toContain('NaN');

    // Variation D: invalid string "not-a-number"
    const p4 = normalizeCatalogSku({ sku_code: 'P-4', name: 'P4', base_price: 'not-a-number' });
    expect(p4.base_price).toBe(0);
    expect(formatPrice(p4.base_price)).toBe('₹0');
    expect(formatPrice(p4.base_price)).not.toContain('NaN');

    // Direct tests on formatPrice edge cases
    expect(formatPrice('not-a-number')).toBe('₹0');
    expect(formatPrice(NaN)).toBe('₹0');
    expect(formatPrice(null)).toBe('₹0');
    expect(formatPrice(undefined)).toBe('₹0');
  });
});
