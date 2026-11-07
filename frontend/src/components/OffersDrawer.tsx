'use client';

import React, { useState, useEffect } from 'react';
import styles from './OffersDrawer.module.css';
import { fetchBuyerNegotiationHistory, type SessionSummary } from '../api/negotiation';
import { formatPrice } from '../api/client';
import { useAuth } from '../context/AuthContext';

export interface OffersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onResumeSession: (sessionId: string, skuCode: string) => void;
}

export function OffersDrawer({ isOpen, onClose, onResumeSession }: OffersDrawerProps) {
  const { isAuthenticated } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadOffers = async (targetPage: number, targetStatus: string, append = false) => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetchBuyerNegotiationHistory(targetPage, targetStatus);
      setSessions((prev) => (append ? [...prev, ...res.sessions] : res.sessions));
      setHasMore(res.hasMore);
      setPage(res.page);
    } catch (err: any) {
      setErrorMsg(err.message || 'We could not load your offers. Please tap to try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      setPage(1);
      loadOffers(1, statusFilter, false);
    }
  }, [isOpen, statusFilter, isAuthenticated]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>My Offers</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close offers drawer"
          >
            ✕
          </button>
        </div>

        {/* Status Filters */}
        <div className={styles.tabs} role="tablist">
          {['ALL', 'IN_PROGRESS', 'AGREED', 'REJECTED'].map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab}
              className={`${styles.tab} ${statusFilter === tab ? styles.tabActive : ''}`}
              onClick={() => setStatusFilter(tab)}
            >
              {tab === 'ALL'
                ? 'All Offers'
                : tab === 'IN_PROGRESS'
                ? 'Active'
                : tab === 'AGREED'
                ? 'Agreed Deals'
                : 'Concluded'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className={styles.content}>
          {errorMsg && (
            <div style={{ color: '#991b1b', fontSize: '0.85rem', textAlign: 'center' }}>
              {errorMsg}
            </div>
          )}

          {!isLoading && sessions.length === 0 && (
            <div className={styles.emptyState}>
              {statusFilter === 'IN_PROGRESS'
                ? 'You have no active price offers right now.'
                : statusFilter === 'AGREED'
                ? 'No agreed deals yet. Start an offer on any wholesale item.'
                : 'You do not have any active or past offers yet.'}
            </div>
          )}

          {sessions.map((item) => {
            const statusUpper = item.status.toUpperCase();
            const badgeClass =
              statusUpper === 'AGREED'
                ? styles.statusAgreed
                : statusUpper === 'IN_PROGRESS'
                ? styles.statusInProgress
                : statusUpper === 'REJECTED'
                ? styles.statusRejected
                : styles.statusExpired;

            return (
              <div key={item.session_id} className={styles.offerCard}>
                <div className={styles.cardTop}>
                  <h3 className={styles.productName}>{item.product_name}</h3>
                  <span className={`${styles.statusBadge} ${badgeClass}`}>
                    {statusUpper === 'IN_PROGRESS' ? 'Negotiating' : statusUpper}
                  </span>
                </div>

                <div className={styles.cardMeta}>
                  <span>
                    {item.quantity} item{item.quantity === 1 ? '' : 's'} · {item.created_date}
                  </span>
                  <span className={styles.priceHighlight}>
                    {item.agreed_price
                      ? formatPrice(item.agreed_price)
                      : item.latest_counter
                      ? formatPrice(item.latest_counter)
                      : formatPrice(item.base_price)}
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.resumeBtn}
                  onClick={() => {
                    onResumeSession(item.session_id, item.sku_code);
                    onClose();
                  }}
                >
                  {statusUpper === 'IN_PROGRESS' ? 'Continue Bargaining ↗' : 'View Details ↗'}
                </button>
              </div>
            );
          })}

          {hasMore && (
            <button
              type="button"
              className={styles.loadMoreBtn}
              onClick={() => loadOffers(page + 1, statusFilter, true)}
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Load More Offers'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
