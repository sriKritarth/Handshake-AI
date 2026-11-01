/**
 * Production Data Contracts & Runtime Schemas
 * Pure TypeScript & zero-dependency defensive schema guards.
 * Eliminates Webpack server vendor-chunk missing module errors.
 */

export interface CatalogSku {
  sku_code: string;
  name: string;
  category: string;
  description: string | null;
  base_price: number;
  Image_url?: string | null;
  image_url?: string | null;
  secure_url?: string | null;
}

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name?: string;
  role: 'buyer' | 'merchant' | 'admin';
}

/**
 * Defensive schema validator for CatalogSku
 */
export const CatalogSkuSchema = {
  parse(data: unknown): CatalogSku {
    return normalizeCatalogSku(data);
  },
  safeParse(data: unknown): { success: boolean; data?: CatalogSku; error?: string } {
    try {
      return { success: true, data: normalizeCatalogSku(data) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};

/**
 * Defensive schema validator for User
 */
export const UserSchema = {
  parse(data: any): User {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid user payload');
    }
    return {
      id: String(data.id || ''),
      email: String(data.email || data.email_id || ''),
      first_name: String(data.first_name || ''),
      last_name: data.last_name ? String(data.last_name) : undefined,
      role: (['buyer', 'merchant', 'admin'].includes(data.role) ? data.role : 'buyer') as any,
    };
  },
};

/**
 * Normalizes backend catalog item payload defensively.
 * Handles Cloudinary response.secure_url, Image_url, image_url, and camelCase imageUrl.
 */
export function normalizeCatalogSku(raw: any): CatalogSku {
  if (!raw || typeof raw !== 'object') {
    return {
      sku_code: 'UNKNOWN',
      name: 'Unnamed Product',
      category: 'General',
      description: null,
      base_price: 0,
      Image_url: null,
      image_url: null,
      secure_url: null,
    };
  }

  // Extract secure URL from all possible backend shapes
  let resolvedSecureUrl: string | null =
    raw.secure_url ||
    raw.Image_url ||
    raw.image_url ||
    raw.imageUrl ||
    raw.secureUrl ||
    (raw.image && typeof raw.image === 'object' ? raw.image.secure_url || raw.image.url : null) ||
    null;

  if (typeof resolvedSecureUrl === 'string' && resolvedSecureUrl.startsWith('http://res.cloudinary.com')) {
    resolvedSecureUrl = resolvedSecureUrl.replace('http://res.cloudinary.com', 'https://res.cloudinary.com');
  }

  const rawPrice = raw.base_price !== undefined ? raw.base_price : raw.price;
  const parsedPrice = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
  const price = !isNaN(parsedPrice) && isFinite(parsedPrice) ? parsedPrice : 0;

  return {
    sku_code: String(raw.sku_code || raw.id || raw.sku || 'SKU-UNKNOWN'),
    name: String(raw.name || raw.title || 'Curated Lot Item'),
    category: String(raw.category || 'General'),
    description: raw.description ? String(raw.description) : null,
    base_price: isNaN(price) ? 0 : price,
    Image_url: resolvedSecureUrl,
    image_url: resolvedSecureUrl,
    secure_url: resolvedSecureUrl,
  };
}
