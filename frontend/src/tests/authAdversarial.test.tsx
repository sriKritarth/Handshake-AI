import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { AuthModal } from '../components/AuthModal';
import { apiClient, normalizeClientMessage } from '../api/client';

// Mock router for next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('token=malformed-token-123'),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

function LogoutTestConsumer() {
  const { logout, token } = useAuth();
  return (
    <div>
      <span data-testid="token-status">{token || 'no-token'}</span>
      <button data-testid="logout-btn" onClick={() => logout()}>
        Logout
      </button>
    </div>
  );
}

describe('ALGORITHM: TestAuthAdversarialScenarios()', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /**
   * 1. Test Double-Submit Prevention:
   *    - When loading == true, ensure submit button is disabled.
   */
  it('1. Double-Submit Prevention: ensures submit button is disabled while request is in flight', async () => {
    // Keep promise pending to simulate active in-flight request
    let resolveLoginPromise: (val: any) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolveLoginPromise = resolve;
    });

    vi.spyOn(apiClient, 'post').mockImplementation(() => pendingPromise as any);

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={() => {}} initialMode="login" />
      </AuthProvider>
    );

    const emailInput = screen.getByPlaceholderText('name@business.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');
    const submitBtn = screen.getByRole('button', { name: /Sign in/i });

    // Initial state: not loading, enabled
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    // Fill form and trigger submit
    fireEvent.change(emailInput, { target: { value: 'buyer@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'Password123!' } });
    fireEvent.click(submitBtn);

    // During loading: button must be disabled to prevent double-submit
    await waitFor(() => {
      const loadingBtn = screen.getByRole('button', { name: /Please wait.../i }) as HTMLButtonElement;
      expect(loadingBtn.disabled).toBe(true);
    });

    // Resolve in-flight request
    await act(async () => {
      resolveLoginPromise({
        token: 'test-token',
        user: { id: 'u1', email: 'buyer@example.com', first_name: 'Buyer', role: 'buyer' },
      });
    });
  });

  /**
   * 2. Test 409 Conflict Handling on Signup:
   *    - Mock API 409 with "User with this email already exists".
   *    - ASSERT error banner renders clean non-technical text.
   */
  it('2. 409 Conflict Handling on Signup: renders clean non-technical text in error banner', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
      status: 409,
      kind: 'conflict',
      message: 'User with this email already exists',
    });

    render(
      <AuthProvider>
        <AuthModal isOpen={true} onClose={() => {}} initialMode="signup" />
      </AuthProvider>
    );

    // Fill out all required fields
    fireEvent.change(screen.getByPlaceholderText('Rahul'), { target: { value: 'Arjun' } });
    fireEvent.change(screen.getByPlaceholderText('Verma'), { target: { value: 'Sharma' } });
    fireEvent.change(screen.getByPlaceholderText('name@business.com'), { target: { value: 'arjun@example.com' } });
    
    const passwordInputs = screen.getAllByPlaceholderText('••••••••');
    fireEvent.change(passwordInputs[0], { target: { value: 'Secret123!' } });
    fireEvent.change(passwordInputs[1], { target: { value: 'Secret123!' } });

    const createBtn = screen.getByRole('button', { name: /Create account/i });
    fireEvent.click(createBtn);

    // Wait for error banner
    await waitFor(() => {
      const errorBanner = screen.getByRole('alert');
      expect(errorBanner).toBeDefined();
      expect(errorBanner.textContent).toBe('User with this email already exists');
      // Assert no technical DB terms are leaked
      expect(errorBanner.textContent).not.toMatch(/pgrst|relation|syntax|constraint|foreign\s*key/i);
    });
  });

  /**
   * 3. Test 500 Server Crash on Logout:
   *    - Mock API 500 on /auth/logout.
   *    - ASSERT localStorage.getItem('auth_token') is still removed (graceful client cleanup).
   */
  it('3. 500 Server Crash on Logout: ensures localStorage auth_token is removed regardless of server crash', async () => {
    localStorage.setItem('auth_token', 'stale-token-to-purge');

    vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
      status: 500,
      kind: 'server',
      message: 'Internal Server Error: Database pool exhausted',
    });

    render(
      <AuthProvider>
        <LogoutTestConsumer />
      </AuthProvider>
    );

    expect(localStorage.getItem('auth_token')).toBe('stale-token-to-purge');

    const logoutBtn = screen.getByTestId('logout-btn');
    fireEvent.click(logoutBtn);

    // Client cleanup must complete even after 500 failure
    await waitFor(() => {
      expect(localStorage.getItem('auth_token')).toBeNull();
      expect(screen.getByTestId('token-status').textContent).toBe('no-token');
    });
  });

  /**
   * 4. Test Malformed Token in Reset Link:
   *    - Mock 400 "Invalid or malformed password reset link".
   *    - ASSERT error banner informs user clearly without leaking JWT stack traces.
   */
  it('4. Malformed Token in Reset Link: informs user clearly without leaking JWT stack traces', async () => {
    // 4a. Check clean human error message passthrough
    const cleanMessage = normalizeClientMessage(
      400,
      'Invalid or malformed password reset link',
      '/auth/reset-password'
    );
    expect(cleanMessage).toBe('Invalid or malformed password reset link');

    // 4b. Check adversarial case: raw JWT stack trace leak from server
    const adversarialRaw =
      'JsonWebTokenError: jwt malformed\n    at Object.module.exports [as verify] (/node_modules/jsonwebtoken/verify.js:133:19)\n    at /backend/dist/controllers/auth.js:84:12';
    
    const sanitizedMessage = normalizeClientMessage(
      400,
      adversarialRaw,
      '/auth/reset-password'
    );

    // Must be sanitized to clean human guidance
    expect(sanitizedMessage).toBe('Invalid or malformed password reset link.');
    expect(sanitizedMessage).not.toMatch(/jwt|jsonwebtoken|at\s+|verify\.js/i);
  });
});
