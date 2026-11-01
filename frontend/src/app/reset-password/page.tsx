'use client';

import { useState, useEffect, Suspense, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './reset-password.module.css';
import { apiClient } from '../../api/client';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tokenParam = searchParams.get('token') || '';

  const [token, setToken] = useState(tokenParam);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (tokenParam) {
      setToken(tokenParam);
    }
  }, [tokenParam]);

  // Validation checkers
  const hasMinLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const isFormValid =
    token.trim().length > 0 &&
    hasMinLength &&
    hasUpper &&
    hasLower &&
    hasNumber &&
    hasSpecial &&
    passwordsMatch;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!token.trim()) {
      setErrorMsg('Please enter the reset code sent to your email.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('The passwords do not match. Please re-enter them.');
      return;
    }

    if (!hasMinLength || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setErrorMsg(
        'Your password must be at least 8 characters long and include an uppercase letter, lowercase letter, number, and special character.'
      );
      return;
    }

    setLoading(true);

    try {
      // Execute the live fetch call to the backend reset-password route
      const res = await apiClient.post<any>('/auth/reset-password', {
        token: token.trim(),
        new_password: newPassword,
        confirm_password: confirmPassword,
      });

      if (res && res.success === false) {
        throw new Error(res.message || 'We could not update your password. Please try again.');
      }

      // Clear password states to prevent auto-saving
      setNewPassword('');
      setConfirmPassword('');
      setIsSuccess(true);
    } catch (err: any) {
      const raw = err?.message || String(err || '');
      if (/jwt|jsonwebtoken|at\s+.*\.(?:js|ts):\d+/i.test(raw)) {
        setErrorMsg('Invalid or malformed password reset link. Please request a new one.');
      } else {
        setErrorMsg(
          err?.message ||
            'This reset link is invalid or has expired. Please request a new one.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.card}>
      {isSuccess ? (
        <div className={styles.successCard} role="status">
          <div className={styles.successIcon}>
            <svg viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className={styles.successTitle}>Password updated</h2>
          <p className={styles.successDesc}>
            Your password has been reset. You can now sign in with your new password.
          </p>
          <Link href="/?auth=login" className={styles.actionBtn}>
            Sign in
          </Link>
        </div>
      ) : (
        <>
          <span className={styles.badge}>Account security</span>
          <h1 className={styles.title}>Reset your password</h1>
          <p className={styles.subtitle}>
            Enter your new password below to regain access to your account.
          </p>

          {errorMsg && (
            <div className={styles.errorBanner} role="alert">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className={styles.form} autoComplete="off">
            {!tokenParam && (
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
            )}

            <div className={styles.fieldGroup}>
              <label className={styles.label}>New Password</label>
              <input
                type="password"
                className={styles.input}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Confirm New Password</label>
              <input
                type="password"
                className={styles.input}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </div>

            <div className={styles.passwordRequirements}>
              <span className={styles.requirementTitle}>Password checklist:</span>
              <div
                className={`${styles.requirementItem} ${
                  hasMinLength ? styles.met : ''
                }`}
              >
                <span>{hasMinLength ? '✓' : '○'}</span> At least 8 characters
              </div>
              <div
                className={`${styles.requirementItem} ${
                  hasUpper ? styles.met : ''
                }`}
              >
                <span>{hasUpper ? '✓' : '○'}</span> One uppercase letter (A-Z)
              </div>
              <div
                className={`${styles.requirementItem} ${
                  hasLower ? styles.met : ''
                }`}
              >
                <span>{hasLower ? '✓' : '○'}</span> One lowercase letter (a-z)
              </div>
              <div
                className={`${styles.requirementItem} ${
                  hasNumber ? styles.met : ''
                }`}
              >
                <span>{hasNumber ? '✓' : '○'}</span> One number (0-9)
              </div>
              <div
                className={`${styles.requirementItem} ${
                  hasSpecial ? styles.met : ''
                }`}
              >
                <span>{hasSpecial ? '✓' : '○'}</span> One special character (!@#$%^&*)
              </div>
              {confirmPassword.length > 0 && (
                <div
                  className={`${styles.requirementItem} ${
                    passwordsMatch ? styles.met : ''
                  }`}
                >
                  <span>{passwordsMatch ? '✓' : '○'}</span> Passwords match
                </div>
              )}
            </div>

            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading || !isFormValid}
            >
              {loading ? 'Saving new password...' : 'Save new password'}
            </button>

            <button
              type="button"
              className={styles.secondaryLink}
              onClick={() => router.push('/')}
            >
              ← Cancel and return to store
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className={styles.pageContainer}>
      <header className={styles.topBar}>
        <div className="wrap">
          <Link href="/" className={styles.brand} aria-label="Handshake AI home">
            <span>handshake</span>
            <small>AI</small>
          </Link>
        </div>
      </header>

      <main className={styles.mainContent}>
        <Suspense
          fallback={
            <div className={styles.card} style={{ textAlign: 'center', padding: '60px 20px' }}>
              <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Loading...</p>
            </div>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </main>
    </div>
  );
}
