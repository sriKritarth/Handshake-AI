'use client';

import { useQuery } from '@tanstack/react-query';
import { executeApiRequest } from '../api/client';
import { normalizeCatalogSku, type CatalogSku } from '../api/schemas';

/**
 * =========================================================================
 * FRONTEND DECISION BOX: ARCHITECTURAL COMPLIANCE & CONTRACT DEFENSE
 * =========================================================================
 * As frontend engineers dealing with this client application, we must adhere
 * to these strict design decisions across all catalog fetch calls:
 *
 * 1. ZERO BACKEND MUTATIONS:
 *    We do not have access to alter backend code in backend/. All schema drift,
 *    field mismatches, and route differences must be solved purely within
 *    this frontend hook and client module.
 *
 * 2. ALGORITHMIC ROUTE MAPPING (ResolveApiCandidates & ExecuteApiRequest):
 *    Fetch candidate chain executed sequentially:
 *      a. NEXT_PUBLIC_BACKEND_URL / BACKEND_URL (e.g. http://localhost:8000/api/v1/catalog)
 *      b. Same-origin reverse-proxy (/api/v1/catalog) configured via next.config.mjs rewrites,
 *         which bypasses browser CORS and mixed-content issues.
 *
 * 3. IDEMPOTENT FAILOVER & STRICT WRITE HALT:
 *    GET requests failover gracefully across candidates. Mutating operations
 *    (POST/PUT/DELETE) halt immediately on network drops to prevent duplicate actions.
 *
 * 4. RESPONSE.SECURE_URL & ASSET PIPELINE MAPPING:
 *    Backend controllers store Cloudinary assets using different casing:
 *      - Cloudinary upload stores `response.secure_url`
 *      - Supabase schema stores `Image_url` (capital I)
 *      - Some payloads deliver `image_url` or `imageUrl`
 *    This hook maps all variants to standard `secure_url`, `Image_url`, and `image_url`
 *    so components and the Cloudinary optimization pipeline never receive undefined.
 *
 * 5. DEFENSIVE PAYLOAD UNWRAPPING:
 *    Handles { success: true, count, data: [...] }, { data: [...] }, { catalog: [...] },
 *    or direct array responses gracefully.
 * =========================================================================
 */
export const CATALOG_DECISION_BOX = {
  zeroBackendMutations:
    'Backend code remains untouched. Frontend hook handles all contract normalization.',
  routeMapping:
    'GET /api/v1/catalog mapped via ResolveApiCandidates & ExecuteApiRequest.',
  secureUrlExtraction:
    'Ingests response.secure_url, item.secure_url, item.Image_url, and item.image_url defensively.',
  payloadCompatibility:
    'Supports { success: true, data: [...] }, { data: [...] }, and raw arrays.',
  errorRecovery:
    'Provides normalized error kinds, actionable refetch, and offline diagnostic messaging.',
} as const;

/**
 * Executes a resilient GET request across all available API candidate roots
 * adhering to ExecuteApiRequest algorithm.
 */
async function fetchCatalogDataFromNetwork(endpoint: string): Promise<any> {
  const response = await executeApiRequest(endpoint, { method: 'GET' });
  const json = await response.json();
  return json;
}

/**
 * Core Catalog Hook for Wholesale Inventory
 * Maps GET /api/v1/catalog and extracts response.secure_url correctly.
 */
export function useCatalog() {
  const query = useQuery<CatalogSku[]>({
    queryKey: ['catalog'],
    queryFn: async () => {
      const rawResponse = await fetchCatalogDataFromNetwork('/catalog');

      // Defensive unwrapping for multiple possible response formats
      let rawList: any[] = [];
      if (Array.isArray(rawResponse)) {
        rawList = rawResponse;
      } else if (Array.isArray(rawResponse?.data)) {
        rawList = rawResponse.data;
      } else if (Array.isArray(rawResponse?.catalog)) {
        rawList = rawResponse.catalog;
      } else if (rawResponse?.data && typeof rawResponse.data === 'object') {
        rawList = [rawResponse.data];
      }

      // Response-level secure_url fallback (e.g. if passed at root)
      const rootSecureUrl = rawResponse?.secure_url || null;

      // Normalize each item defensively
      const normalizedItems = rawList.map((item) => {
        const itemWithRootFallback = {
          ...item,
          secure_url: item?.secure_url || rootSecureUrl,
        };
        return normalizeCatalogSku(itemWithRootFallback);
      });

      return normalizedItems;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes fresh
    retry: 2,
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    decisionBox: CATALOG_DECISION_BOX,
  };
}

/**
 * Single SKU Lookup Hook
 * Maps GET /api/v1/catalog/:sku_code with fresh Cloudinary secure_url extraction.
 */
export function useCatalogItem(skuCode: string | null | undefined) {
  return useQuery<CatalogSku | null>({
    queryKey: ['catalog', skuCode],
    queryFn: async () => {
      if (!skuCode) return null;
      const rawResponse = await fetchCatalogDataFromNetwork(`/catalog/${encodeURIComponent(skuCode)}`);
      const itemData = rawResponse?.data !== undefined ? rawResponse.data : rawResponse;
      if (!itemData) return null;
      return normalizeCatalogSku(itemData);
    },
    enabled: !!skuCode,
    staleTime: 1000 * 60 * 5,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
