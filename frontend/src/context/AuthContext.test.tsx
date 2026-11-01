import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { apiClient } from '../api/client';

function TestConsumer() {
  const { user, token, isAuthenticated, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="auth">{String(isAuthenticated)}</span>
      <span data-testid="user">{user ? user.first_name : 'none'}</span>
      <span data-testid="token">{token || 'none'}</span>
    </div>
  );
}

describe('ALGORITHM: SafeSessionRestore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('1. On App Mount with no token: sets isLoading=false and returns', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId('loading').textContent).toBe('false');
    });

    expect(getByTestId('auth').textContent).toBe('false');
    expect(getByTestId('user').textContent).toBe('none');
    expect(getByTestId('token').textContent).toBe('none');
  });

  it('2a. HTTP 200 on /auth/me: sets user in state', async () => {
    localStorage.setItem('auth_token', 'valid-jwt-token');

    vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
      user: {
        id: 'u-123',
        email: 'shopper@wholesale.com',
        first_name: 'Aarav',
        role: 'buyer',
      },
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId('loading').textContent).toBe('false');
    });

    expect(getByTestId('auth').textContent).toBe('true');
    expect(getByTestId('user').textContent).toBe('Aarav');
    expect(localStorage.getItem('auth_token')).toBe('valid-jwt-token');
  });

  it('2b. HTTP 401 on /auth/me: clears localStorage and sets user=null', async () => {
    localStorage.setItem('auth_token', 'expired-jwt-token');

    vi.spyOn(apiClient, 'get').mockRejectedValueOnce({
      status: 401,
      message: 'Your session has expired. Please sign in again.',
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId('loading').textContent).toBe('false');
    });

    expect(getByTestId('auth').textContent).toBe('false');
    expect(getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('2c. NetworkError or Timeout on /auth/me: KEEPS token intact in localStorage', async () => {
    localStorage.setItem('auth_token', 'valid-jwt-offline');

    vi.spyOn(apiClient, 'get').mockRejectedValueOnce({
      kind: 'network',
      message: 'Failed to fetch',
    });

    const { getByTestId } = render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId('loading').textContent).toBe('false');
    });

    // Token must remain intact in localStorage so user stays signed in when network returns!
    expect(localStorage.getItem('auth_token')).toBe('valid-jwt-offline');
    expect(getByTestId('token').textContent).toBe('valid-jwt-offline');
  });
});
