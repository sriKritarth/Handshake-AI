import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  ApiError,
  resolveApiCandidates,
  normalizeClientMessage,
} from './client';

describe('API Client utilities', () => {
  it('formats Indian Rupee (INR) prices correctly without decimals', () => {
    expect(formatPrice(1200)).toBe('₹1,200');
    expect(formatPrice(45000)).toBe('₹45,000');
    expect(formatPrice(0)).toBe('₹0');
  });

  it('instantiates ApiError with status and normalized error details', () => {
    const error = new ApiError({
      kind: 'http',
      message: 'Product not found',
      status: 404,
      code: 'NOT_FOUND',
      retryable: false,
    });
    expect(error.message).toBe('Product not found');
    expect(error.status).toBe(404);
    expect(error.kind).toBe('http');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.retryable).toBe(false);
    expect(error.name).toBe('ApiError');
  });

  it('ResolveApiCandidates returns clean, prioritized base URLs and relative /api/v1', () => {
    const candidates = resolveApiCandidates();
    expect(candidates).toContain('/api/v1');
    expect(candidates.every((c) => typeof c === 'string' && c.trim().length > 0)).toBe(true);
    // Ensure no duplicates
    const set = new Set(candidates);
    expect(set.size).toBe(candidates.length);
  });
});

describe('ALGORITHM: NormalizeClientMessage', () => {
  it('handles 401 on /auth/login with incorrect credentials message', () => {
    const msg = normalizeClientMessage(401, 'Unauthorized', '/auth/login');
    expect(msg).toBe('Incorrect email or password.');
  });

  it('handles 401 on other endpoints with session expired message', () => {
    const msg = normalizeClientMessage(401, 'jwt expired', '/sessions');
    expect(msg).toBe('Your session has expired. Please sign in again.');
  });

  it('masks internal database errors on 400 or 422', () => {
    const pgrst = normalizeClientMessage(400, 'PGRST116: JSON object requested, multiple rows returned');
    expect(pgrst).toBe('Please check your entered details and try again.');

    const syntax = normalizeClientMessage(422, 'syntax error at or near relation "users"');
    expect(syntax).toBe('Please check your entered details and try again.');

    const fkey = normalizeClientMessage(400, 'violates foreign key constraint "catalog_fk"');
    expect(fkey).toBe('Please check your entered details and try again.');
  });

  it('preserves human guidance on 400 or 422', () => {
    const guidance = 'Password must contain at least one uppercase letter';
    const msg = normalizeClientMessage(400, guidance);
    expect(msg).toBe(guidance);

    const matchMsg = 'Passwords do not match';
    expect(normalizeClientMessage(422, matchMsg)).toBe(matchMsg);
  });

  it('returns generic momentary server message for 500+', () => {
    expect(normalizeClientMessage(500, 'Internal Server Error')).toBe(
      'Our servers are momentarily busy. Please try again shortly.'
    );
    expect(normalizeClientMessage(502, 'Bad Gateway')).toBe(
      'Our servers are momentarily busy. Please try again shortly.'
    );
    expect(normalizeClientMessage(503, 'Service Unavailable')).toBe(
      'Our servers are momentarily busy. Please try again shortly.'
    );
  });
});
