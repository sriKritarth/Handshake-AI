'use client';

import styles from './Header.module.css';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';

export interface HeaderProps {
  onOpenCart?: () => void;
  onOpenAuth: () => void;
  onOpenOffers?: () => void;
  onToggleSaved: () => void;
  onlySaved: boolean;
  onSearchFocus?: () => void;
}

export function Header({
  onOpenCart,
  onOpenAuth,
  onOpenOffers,
  onToggleSaved,
  onlySaved,
  onSearchFocus,
}: HeaderProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { cartCount, saved } = useCart();

  return (
    <>
      <div className="utility">Curated wholesale goods · Live negotiation & volume pricing</div>
      <div className="wrap">
        <header className={styles.header}>
          <a href="#" className={styles.brand} aria-label="Handshake AI home">
            <span className={styles.mark} aria-hidden="true">
              h
            </span>
            handshake<small>AI</small>
          </a>

          <nav className={styles.nav} aria-label="Main navigation">
            <a href="#collection">Products</a>
            <a href="#about">About</a>
            <a href="#contact">Contact us</a>
          </nav>

          <div className={styles.tools}>
            {onSearchFocus && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onSearchFocus}
                aria-label="Search products"
                title="Search products"
              >
                <svg viewBox="0 0 24 24">
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 5 5" />
                </svg>
              </button>
            )}

            <button
              type="button"
              className={styles.iconBtn}
              onClick={onToggleSaved}
              aria-label={onlySaved ? 'Show all products' : 'Show saved items'}
              aria-pressed={onlySaved}
              title={saved.length === 1 ? '1 item saved' : `${saved.length} items saved`}
            >
              <svg viewBox="0 0 24 24" fill={onlySaved ? 'var(--green)' : 'none'}>
                <path d="M12 20S2 14 2 7.7C2 2 9 1 12 6c3-5 10-4 10 1.7C22 14 12 20 12 20Z" />
              </svg>
            </button>

            {onOpenCart && (
              <button
                type="button"
                className={styles.bagBtn}
                onClick={onOpenCart}
                aria-label={`Open cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              >
                <span>Cart</span>
                <span className={styles.bagCount}>{cartCount}</span>
              </button>
            )}

            {isAuthenticated && onOpenOffers && (
              <button
                type="button"
                className={styles.bagBtn}
                onClick={onOpenOffers}
                aria-label="View negotiation offers"
                style={{ background: '#f5f5f0', color: 'var(--ink)' }}
              >
                <span>Offers</span>
              </button>
            )}

            {isAuthenticated && user ? (
              <div className={styles.userBadge}>
                <span>Hi, {user.first_name}</span>
                <span className={styles.roleTag}>
                  {user.role === 'buyer' ? 'Buyer' : user.role === 'merchant' ? 'Supplier' : 'Admin'}
                </span>
                <button type="button" className={styles.signOutBtn} onClick={logout}>
                  Sign out
                </button>
              </div>
            ) : (
              <button type="button" className={styles.authBtn} onClick={onOpenAuth}>
                Sign in
              </button>
            )}
          </div>
        </header>
      </div>
    </>
  );
}
