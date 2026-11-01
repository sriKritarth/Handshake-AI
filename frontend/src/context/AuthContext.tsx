'use client';

import React, { createContext, useState, useEffect, useContext, useCallback, type ReactNode } from 'react';
import { apiClient } from '../api/client';
import type { User } from '../api/schemas';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email_id: string, password: string) => Promise<void>;
  signup: (payload: {
    first_name: string;
    last_name: string;
    email_id: string;
    password: string;
    confirm_password: string;
    role: 'buyer' | 'merchant';
  }) => Promise<void>;
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ success: boolean; message: string }>;
  resetPassword: (payload: {
    token: string;
    new_password: string;
    confirm_password: string;
  }) => Promise<{ success: boolean; message: string }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * ALGORITHM: SafeSessionRestore()
   * 1. On App Mount:
   *    a. Read token from localStorage.
   *    b. If no token: set isLoading = false and return.
   * 2. Call GET "/auth/me":
   *    a. If HTTP 200: set user in state.
   *    b. If HTTP 401 (Unauthorized): token invalid, clear localStorage and setUser(null).
   *    c. If NetworkError or Timeout:
   *       - DO NOT clear localStorage.
   *       - Keep token intact so user stays signed in when network returns.
   */
  const loadMe = useCallback(async () => {
    // 1. On App Mount:
    if (typeof window === 'undefined') return;

    // a. Read token from localStorage.
    const storedToken = localStorage.getItem('auth_token');

    // b. If no token: set isLoading = false and return.
    if (!storedToken) {
      setToken(null);
      setUser(null);
      setIsLoading(false);
      return;
    }

    setToken(storedToken);

    // 2. Call GET "/auth/me":
    try {
      const res = await apiClient.get<any>('/auth/me');
      // a. If HTTP 200: set user in state.
      if (res?.user) {
        setUser(res.user);
      } else if (res?.id) {
        setUser(res);
      }
    } catch (err: any) {
      // b. If HTTP 401 (Unauthorized): token invalid, clear localStorage and setUser(null).
      if (err?.status === 401 || err?.kind === 'unauthorized') {
        localStorage.removeItem('auth_token');
        setToken(null);
        setUser(null);
      }
      // c. If NetworkError or Timeout:
      //    - DO NOT clear localStorage.
      //    - Keep token intact so user stays signed in when network returns.
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Restore user session on mount
  useEffect(() => {
    loadMe();

    // Listen for 401 unauthorized events from API client
    const handleUnauthorized = () => {
      setToken(null);
      setUser(null);
      localStorage.removeItem('auth_token');
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [loadMe]);

  const login = async (email_id: string, password: string) => {
    const res = await apiClient.post<any>('/auth/login', { email_id, password });
    if (res?.token) {
      localStorage.setItem('auth_token', res.token);
      setToken(res.token);
      setUser(res.user);
    }
  };

  const signup = async (payload: {
    first_name: string;
    last_name: string;
    email_id: string;
    password: string;
    confirm_password: string;
    role: 'buyer' | 'merchant';
  }) => {
    const res = await apiClient.post<any>('/auth/sign_up', payload);
    if (res?.token) {
      localStorage.setItem('auth_token', res.token);
      setToken(res.token);
      setUser(res.user);
    }
  };

  const logout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Continue client cleanup
    } finally {
      localStorage.removeItem('auth_token');
      setToken(null);
      setUser(null);
    }
  };

  const forgotPassword = async (email: string) => {
    const res = await apiClient.post<any>('/auth/forgot-password', { email });
    return {
      success: res?.success ?? true,
      message: res?.message || 'If an account exists with that email address, we have sent a password reset link.',
    };
  };

  const resetPassword = async (payload: {
    token: string;
    new_password: string;
    confirm_password: string;
  }) => {
    const res = await apiClient.post<any>('/auth/reset-password', payload);
    return {
      success: res?.success ?? true,
      message: res?.message || 'Your password has been updated. Please sign in with your new password.',
    };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        login,
        signup,
        loadMe,
        logout,
        forgotPassword,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
