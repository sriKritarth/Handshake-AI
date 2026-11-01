'use client';

import React, { useState, useEffect, type FormEvent } from 'react';
import styles from './AuthModal.module.css';
import { useAuth } from '../context/AuthContext';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: AuthMode;
  initialToken?: string;
}

export function AuthModal({
  isOpen,
  onClose,
  initialMode = 'login',
  initialToken = '',
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'buyer' | 'merchant'>('buyer');
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const { login, signup, forgotPassword, resetPassword } = useAuth();

  const resetFormState = () => {
    setPassword('');
    setConfirmPassword('');
    setNewPassword('');
    setFormError(null);
  };

  const handleClose = () => {
    resetFormState();
    setSuccessMsg(null);
    onClose();
  };

  // Reset password states whenever modal opens or closes to prevent auto-saved/persisted credentials
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      resetFormState();
      setSuccessMsg(null);
      if (initialToken) setToken(initialToken);
    } else {
      resetFormState();
    }
  }, [isOpen, initialMode, initialToken]);

  // Handle ESC
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setFormError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        if (!email.trim() || !password) {
          throw new Error('Please enter your correct email or password.');
        }
        await login(email.trim(), password);
        handleClose();
      } else if (mode === 'signup') {
        if (!firstName.trim() || !lastName.trim()) {
          throw new Error('Please enter both your first and last name.');
        }
        if (password !== confirmPassword) {
          throw new Error('The passwords do not match. Please re-enter them.');
        }
        await signup({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email_id: email.trim(),
          password,
          confirm_password: confirmPassword,
          role,
        });
        handleClose();
      } else if (mode === 'forgot') {
        const res = await forgotPassword(email.trim());
        setSuccessMsg(res.message || 'We have sent a password reset link to your email.');
      } else if (mode === 'reset') {
        if (newPassword !== confirmPassword) {
          throw new Error('The passwords do not match. Please re-enter them.');
        }
        const res = await resetPassword({
          token: token.trim(),
          new_password: newPassword,
          confirm_password: confirmPassword,
        });
        setSuccessMsg(res.message || 'Your password has been updated. Please sign in to continue.');
        resetFormState();
        setTimeout(() => setMode('login'), 2000);
      }
    } catch (err: any) {
      if (mode === 'login') {
        if (err?.kind === 'network' || err?.kind === 'timeout') {
          setFormError(err.message || 'We could not connect right now. Please check your internet connection and try again.');
        } else {
          setFormError('Please enter your correct email or password.');
        }
      } else {
        setFormError(err.message || 'We could not complete your request. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={handleClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Close dialog"
        >
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Tab Switcher for Sign In / Sign Up */}
        {(mode === 'login' || mode === 'signup') && (
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`${styles.tab} ${mode === 'login' ? styles.active : ''}`}
              onClick={() => {
                setMode('login');
                resetFormState();
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              className={`${styles.tab} ${mode === 'signup' ? styles.active : ''}`}
              onClick={() => {
                setMode('signup');
                resetFormState();
              }}
            >
              Create account
            </button>
          </div>
        )}

        <h2 className={styles.title}>
          {mode === 'login' && 'Welcome back'}
          {mode === 'signup' && 'Create your account'}
          {mode === 'forgot' && 'Reset password'}
          {mode === 'reset' && 'Set new password'}
        </h2>
        <p className={styles.subtitle}>
          {mode === 'login' && 'Sign in to access your negotiated offers and saved cart.'}
          {mode === 'signup' && 'Join Handshake AI as a wholesale buyer or supplier.'}
          {mode === 'forgot' && 'Enter your email address to receive a password reset link.'}
          {mode === 'reset' && 'Enter the reset code sent to your email and your new password.'}
        </p>

        {formError && (
          <div className={styles.errorBanner} role="alert">
            {formError}
          </div>
        )}

        {successMsg && (
          <div className={styles.successBanner} role="status">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form} autoComplete="off">
          {mode === 'signup' && (
            <>
              <div className={styles.fieldRow}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>First name</label>
                  <input
                    type="text"
                    className={styles.input}
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Rahul"
                    autoComplete="off"
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label}>Last name</label>
                  <input
                    type="text"
                    className={styles.input}
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Verma"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Account type</label>
                <select
                  className={styles.roleSelect}
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                >
                  <option value="buyer">Wholesale buyer (Retailer or business)</option>
                  <option value="merchant">Supplier (Merchant or brand)</option>
                </select>
              </div>
            </>
          )}

          {(mode === 'login' || mode === 'signup' || mode === 'forgot') && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Email address</label>
              <input
                type="email"
                className={styles.input}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@business.com"
                autoComplete="off"
              />
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Password</label>
              <input
                type="password"
                className={styles.input}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>
          )}

          {mode === 'signup' && (
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Confirm password</label>
              <input
                type="password"
                className={styles.input}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>
          )}

          {mode === 'reset' && (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Reset code</label>
                <input
                  type="text"
                  className={styles.input}
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste code from your email"
                  autoComplete="off"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>New password</label>
                <input
                  type="password"
                  className={styles.input}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Confirm new password</label>
                <input
                  type="password"
                  className={styles.input}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
              </div>
            </>
          )}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Please wait...' : null}
            {!loading && mode === 'login' && 'Sign in'}
            {!loading && mode === 'signup' && 'Create account'}
            {!loading && mode === 'forgot' && 'Send reset link'}
            {!loading && mode === 'reset' && 'Save new password'}
          </button>

          <div className={styles.footerLinks}>
            {mode === 'login' && (
              <button
                type="button"
                className={styles.textBtn}
                onClick={() => {
                  setMode('forgot');
                  resetFormState();
                }}
              >
                Forgot your password?
              </button>
            )}

            {(mode === 'forgot' || mode === 'reset') && (
              <button
                type="button"
                className={styles.textBtn}
                onClick={() => {
                  setMode('login');
                  resetFormState();
                }}
              >
                ← Back to sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
