export type ErrorKind = 'network' | 'timeout' | 'aborted' | 'http' | 'validation';

export interface NormalizedError {
  kind: ErrorKind;
  status?: number;
  code?: string;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export class ApiError extends Error implements NormalizedError {
  kind: ErrorKind;
  status?: number;
  code?: string;
  retryable: boolean;
  requestId?: string;

  constructor(normalized: NormalizedError) {
    super(normalized.message);
    this.name = 'ApiError';
    this.kind = normalized.kind;
    this.status = normalized.status;
    this.code = normalized.code;
    this.retryable = normalized.retryable;
    this.requestId = normalized.requestId;
  }
}

/**
 * Format currency in Indian Rupees (INR) using Intl.NumberFormat
 */
export function formatPrice(amount: number | string | null | undefined): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  const safeAmount = !isNaN(numeric) && isFinite(numeric) ? numeric : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(safeAmount);
}

/**
 * ALGORITHM: NormalizeClientMessage(status, rawMessage, endpoint)
 * 1. IF status == 401:
 *    a. If endpoint is "/auth/login": return "Incorrect email or password."
 *    b. Otherwise: return "Your session has expired. Please sign in again."
 *
 * 2. IF status == 400 OR status == 422:
 *    a. If rawMessage mentions internal DB (e.g. "PGRST", "relation", "syntax", "foreign key"):
 *       - Return "Please check your entered details and try again."
 *    b. If rawMessage has human guidance (e.g. "Password must contain at least one uppercase letter"):
 *       - Preserve and return the exact clear message so user knows what to fix.
 *
 * 3. IF status >= 500:
 *    - Return "Our servers are momentarily busy. Please try again shortly."
 */
export function normalizeClientMessage(
  status: number | undefined,
  rawMessage: string | null | undefined,
  endpoint = ''
): string {
  const cleanEndpoint = endpoint.toLowerCase();
  const raw = (rawMessage || '').trim();

  // 1. IF status == 401:
  if (status === 401) {
    // a. If endpoint is "/auth/login": return "Incorrect email or password."
    if (cleanEndpoint.includes('/auth/login')) {
      return 'Incorrect email or password.';
    }
    // b. Otherwise: return "Your session has expired. Please sign in again."
    return 'Your session has expired. Please sign in again.';
  }

  // 2. IF status == 400 OR status == 409 OR status == 422:
  if (status === 400 || status === 409 || status === 422) {
    if (status === 409) {
      if (raw.length > 0 && !/pgrst|relation|syntax|foreign\s*key|table|violates|duplicate\s*key/i.test(raw)) {
        return raw;
      }
      return 'User with this email already exists.';
    }

    // a. Check for internal DB or technical stack traces (PGRST, SQL, JWT stack traces)
    const technicalLeakPattern = /pgrst|relation|syntax|foreign\s*key|column|supabase|postgres|table|violates|duplicate\s*key|jwt|jsonwebtoken|at\s+.*\.(?:js|ts):\d+/i;
    
    if (technicalLeakPattern.test(raw)) {
      if (cleanEndpoint.includes('/reset-password') || /jwt|token/i.test(raw)) {
        return 'Invalid or malformed password reset link.';
      }
      return 'Please check your entered details and try again.';
    }

    // b. If rawMessage has human guidance:
    // Preserve and return the exact clear message so user knows what to fix.
    if (raw.length > 0) {
      return raw;
    }
    return 'Please check your entered details and try again.';
  }

  // 3. IF status >= 500:
  if (status !== undefined && status >= 500) {
    return 'Our servers are momentarily busy. Please try again shortly.';
  }

  // Default fallback for other specific statuses
  if (status === 410) {
    return 'This negotiation has closed due to inactivity. Please start a new offer to continue.';
  }

  return raw || 'Something went wrong on our end. Please try again or refresh the page.';
}

/**
 * Normalize raw errors into a consistent structure for UI rendering
 */
export function normalizeError(err: unknown, endpoint = ''): NormalizedError {
  if (err instanceof ApiError) {
    return {
      kind: err.kind,
      status: err.status,
      code: err.code,
      message: err.message,
      retryable: err.retryable,
      requestId: err.requestId,
    };
  }

  if (err && typeof err === 'object') {
    const errorObj = err as Record<string, unknown>;

    // AbortController timeout / cancellation
    if (errorObj.name === 'AbortError' || errorObj.message === 'The user aborted a request.') {
      return {
        kind: 'timeout',
        message: 'This is taking longer than expected. Please check your internet connection and try again.',
        retryable: true,
      };
    }

    // Network disconnection or fetch failure
    if (err instanceof TypeError || errorObj.message === 'Failed to fetch') {
      return {
        kind: 'network',
        message: 'We could not connect right now. Please check your internet connection and try again.',
        retryable: true,
      };
    }

    // HTTP Status responses
    if (typeof errorObj.status === 'number') {
      const status = errorObj.status;
      const rawMessage = (errorObj.message as string) || '';
      const clientMessage = normalizeClientMessage(status, rawMessage, endpoint);

      let kind: ErrorKind = 'http';
      if (status === 400 || status === 422) {
        kind = 'validation';
      }

      return {
        kind,
        status,
        message: clientMessage,
        retryable: status >= 500,
      };
    }
  }

  return {
    kind: 'http',
    message:
      err instanceof Error
        ? err.message
        : 'Something went wrong on our end. Please try again or refresh the page.',
    retryable: false,
  };
}

/**
 * ALGORITHM: ResolveApiCandidates()
 * INPUT: 
 *   - process.env.NEXT_PUBLIC_BACKEND_URL
 *   - process.env.BACKEND_URL
 * OUTPUT: 
 *   - candidates: Array of clean, prioritized API base URLs
 */
export function resolveApiCandidates(): string[] {
  // 1. Initialize empty list: candidates = []
  const candidates: string[] = [];

  // 2. READ & VALIDATE ENVIRONMENT VARIABLE:
  // a. rawUrl = process.env.NEXT_PUBLIC_BACKEND_URL OR process.env.BACKEND_URL
  const rawUrl =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
    (typeof process !== 'undefined' && process.env?.BACKEND_URL);

  // b. IF rawUrl is a valid string AND rawUrl.trim() != "":
  if (typeof rawUrl === 'string' && rawUrl.trim() !== '') {
    // i. cleanUrl = remove trailing slash from rawUrl.trim()
    const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
    // ii. apiBase = cleanUrl + "/api/v1"
    const apiBase = `${cleanUrl}/api/v1`;
    // iii. candidates.append(apiBase)
    candidates.push(apiBase);
  }

  // 3. ADD RELATIVE REVERSE-PROXY (Next.js rewrites):
  // a. candidates.append("/api/v1")
  // Reason: Same-origin relative path bypasses browser CORS and mixed-content issues in production.
  candidates.push('/api/v1');

  // 4. PURGE INVALID ENTRIES:
  // a. Filter out any null, undefined, or empty strings.
  const filtered = candidates.filter((c) => typeof c === 'string' && c.trim() !== '');
  // b. Remove duplicates: uniqueCandidates = Array.from(new Set(candidates))
  const uniqueCandidates = Array.from(new Set(filtered));

  // 5. RETURN uniqueCandidates
  return uniqueCandidates;
}

// Backward-compatible alias
export const getApiBaseCandidates = resolveApiCandidates;

export const BACKEND_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BACKEND_URL) ||
  (typeof process !== 'undefined' && process.env?.BACKEND_URL) ||
  'http://localhost:8000';

export const API_BASE = `${String(BACKEND_URL).replace(/\/+$/, '')}/api/v1`;

export function resolveApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${cleanEndpoint}`;
}

/**
 * ALGORITHM: ExecuteApiRequest(endpoint, options)
 * INPUT:
 *   - endpoint: string (e.g. "/catalog", "/auth/login")
 *   - options: RequestInit (method, headers, body)
 */
export async function executeApiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  // 1. candidates = ResolveApiCandidates()
  const candidates = resolveApiCandidates();

  // 2. isIdempotent = (!options.method || options.method == "GET" || options.method == "HEAD")
  const method = (options.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let lastError: unknown = null;

  // 3. FOR EACH base IN candidates:
  for (const base of candidates) {
    // a. targetUrl = base + endpoint
    const targetUrl = `${base}${cleanEndpoint}`;

    // b. TRY:
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // i. Execute fetch(targetUrl) with 8-second timeout.

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(targetUrl, {
        ...options,
        signal: options.signal || controller.signal,
        headers,
      });

      clearTimeout(timeoutId);

      // ii. IF response.status is received (even 4xx or 5xx):
      // - Server was reached.
      // - IF response.status == 401 AND endpoint != "/auth/login":
      //      clear auth token from localStorage.
      if (
        response.status === 401 &&
        !cleanEndpoint.includes('/auth/login') &&
        typeof window !== 'undefined'
      ) {
        localStorage.removeItem('auth_token');
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }

      // Check if response is ok. If not ok, throw ApiError with normalized client message
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const rawMessage = errorJson.message || `HTTP ${response.status}`;
        const normalized = normalizeError(
          {
            status: response.status,
            message: rawMessage,
          },
          cleanEndpoint
        );
        throw new ApiError(normalized);
      }

      // - Return response.
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;

      // If error is an ApiError (i.e. server was reached and responded with 4xx/5xx), do not treat as network drop!
      if (err instanceof ApiError) {
        throw err;
      }

      // c. CATCH (Connection dropped or network timeout):
      // i. IF isIdempotent == true:
      //    - Try next candidate in the list.
      if (isIdempotent) {
        continue;
      }

      // ii. IF isIdempotent == false (POST / PUT / DELETE):
      //    - STOP immediately.
      //    - DO NOT retry on next candidate (prevents duplicate orders or signups).
      //    - Throw NetworkError to user.
      const normalized = normalizeError(
        {
          kind: 'network',
          message: 'Network connection dropped. Request stopped to prevent duplicate actions.',
          retryable: false,
        },
        cleanEndpoint
      );
      throw new ApiError(normalized);
    }
  }

  // 4. IF all candidates fail:
  // - Normalize error and throw ApiError.
  const normalized = normalizeError(lastError, cleanEndpoint);
  throw new ApiError(normalized);
}

export const apiClient = {
  async get<T>(endpoint: string): Promise<T> {
    const res = await executeApiRequest(endpoint, { method: 'GET' });
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  },

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const res = await executeApiRequest(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return json;
  },
};
