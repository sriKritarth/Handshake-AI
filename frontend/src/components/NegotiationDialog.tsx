'use client';

import React, { useState, useEffect, useRef, type FormEvent } from 'react';
import styles from './NegotiationDialog.module.css';
import { useNegotiationSession } from '../hooks/useNegotiationSession';
import { formatPrice } from '../api/client';
import type { CatalogSku } from '../api/schemas';
import { useAuth } from '../context/AuthContext';

export interface NegotiationDialogProps {
  isOpen: boolean;
  sessionId: string | null;
  product: CatalogSku | null;
  initialQuantity?: number;
  onClose: () => void;
  onOpenAuth?: () => void;
  onProceedToCheckout?: () => void;
}

export function NegotiationDialog({
  isOpen,
  sessionId,
  product,
  initialQuantity = 1,
  onClose,
  onOpenAuth,
  onProceedToCheckout,
}: NegotiationDialogProps) {
  const { isAuthenticated } = useAuth();
  const [offerPrice, setOfferPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(initialQuantity);

  const {
    session,
    transcript,
    currentQuote,
    isBusy,
    isLiveConnected,
    errorText,
    status,
    hydrate,
    submitOffer,
    acceptDeal,
    declineOffer,
    suggestBestPrice,
    autoNegotiate,
    closeStream,
    setErrorText,
  } = useNegotiationSession();

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Hydrate session or reset form on open
  useEffect(() => {
    if (isOpen && sessionId) {
      hydrate(sessionId);
    } else {
      closeStream();
    }
  }, [isOpen, sessionId, hydrate, closeStream]);

  // Update default offer price when product or session changes
  useEffect(() => {
    if (product?.base_price && !offerPrice) {
      // Suggest standard volume starting discount (e.g. 10% below list price)
      const suggestedStart = Math.round(product.base_price * 0.9);
      setOfferPrice(String(suggestedStart));
    }
  }, [product, offerPrice]);

  // Sync initial quantity
  useEffect(() => {
    if (initialQuantity > 0) {
      setQuantity(initialQuantity);
    }
  }, [initialQuantity]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript]);

  // Handle ESC key press
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !product) return null;

  const isTerminal = ['AGREED', 'REJECTED', 'EXPIRED', 'PAID'].includes(status);
  const isAgreed = status === 'AGREED' || currentQuote?.accepted === true;

  const handlePropose = async (e: FormEvent) => {
    e.preventDefault();
    if (isBusy || isTerminal) return;

    if (!isAuthenticated) {
      if (onOpenAuth) onOpenAuth();
      return;
    }

    const priceNum = Number(offerPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setErrorText('Please enter a valid price greater than ₹0.');
      return;
    }

    await submitOffer(priceNum, quantity);
  };

  const handleAccept = async () => {
    if (!product) return;
    await acceptDeal(product, () => {
      onClose();
      if (onProceedToCheckout) {
        onProceedToCheckout();
      }
    });
  };

  const handleDecline = async () => {
    await declineOffer(() => {
      onClose();
    });
  };

  const handleSuggest = async () => {
    const target = offerPrice ? Number(offerPrice) : undefined;
    await suggestBestPrice(target);
  };

  const handleAutoRun = async () => {
    const target = offerPrice ? Number(offerPrice) : undefined;
    await autoNegotiate(target);
  };

  const listUnitPrice = product.base_price || 0;
  const currentUnitPrice = currentQuote?.unitPrice || listUnitPrice;
  const quoteQty = currentQuote?.quantity || quantity;
  const savingsPerUnit = Math.max(0, listUnitPrice - currentUnitPrice);
  const savingsPercent =
    listUnitPrice > 0 && savingsPerUnit > 0
      ? Math.round((savingsPerUnit / listUnitPrice) * 100)
      : 0;

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="negotiation-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.productSummary}>
            <div className={styles.headerTopRow}>
              <span className={styles.badge}>Live Wholesale Bargain</span>
              <span className={styles.liveIndicator}>
                <span
                  className={`${styles.liveDot} ${
                    !isLiveConnected ? styles.liveDotOffline : ''
                  }`}
                />
                {isLiveConnected ? 'Connected to live seller' : 'Live updates standby'}
              </span>
            </div>
            <h2 id="negotiation-title" className={styles.productName}>
              {product.name}
            </h2>
            <div className={styles.pricingMeta}>
              List Price: {formatPrice(product.base_price)} · SKU: {product.sku_code}
            </div>
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close negotiation dialog"
          >
            <svg viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body / Chat */}
        <div className={styles.body}>
          <div className={styles.chatTranscript} role="log" aria-live="polite">
            {transcript.map((msg) => {
              const isBuyer = msg.sender === 'BUYER';
              const isSeller = msg.sender === 'SELLER';
              const isAssistant = msg.sender === 'ASSISTANT';
              const isSystem = msg.sender === 'SYSTEM';

              return (
                <div
                  key={msg.id}
                  className={`${styles.messageRow} ${
                    isBuyer
                      ? styles.rowBuyer
                      : isSeller
                      ? styles.rowSeller
                      : isAssistant
                      ? styles.rowAssistant
                      : styles.rowSystem
                  }`}
                >
                  {!isSystem && (
                    <span className={styles.messageSender}>
                      {isBuyer ? 'You' : isAssistant ? 'Pricing Assistant' : 'Wholesale Supplier'}
                    </span>
                  )}
                  <div
                    className={`${styles.bubble} ${
                      isBuyer
                        ? styles.bubbleBuyer
                        : isSeller
                        ? styles.bubbleSeller
                        : isAssistant
                        ? styles.bubbleAssistant
                        : styles.bubbleSystem
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className={styles.messageTime}>{msg.timestamp}</span>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          {/* Error Banner */}
          {errorText && (
            <div className={styles.errorBanner} role="alert">
              {errorText}
            </div>
          )}

          {/* Current Best Quote Floating Card */}
          {currentQuote && (
            <div className={styles.quoteCard}>
              <div className={styles.quoteInfo}>
                <span className={styles.quoteLabel}>
                  {isAgreed ? 'Agreed Deal Price' : 'Current Active Offer'}
                </span>
                <span className={styles.quotePrice}>
                  {formatPrice(currentUnitPrice)}
                  <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontWeight: 400 }}>
                    {' '}
                    / unit ({quoteQty} units · {formatPrice(currentUnitPrice * quoteQty)})
                  </span>
                </span>
                {savingsPercent > 0 && (
                  <span className={styles.quoteSavings}>
                    Save {savingsPercent}% off standard wholesale rate
                  </span>
                )}
              </div>

              <div className={styles.quoteActions}>
                {!isTerminal && (
                  <button
                    type="button"
                    className={styles.declineBtn}
                    onClick={handleDecline}
                    disabled={isBusy}
                  >
                    Decline & Walk Away
                  </button>
                )}
                <button
                  type="button"
                  className={styles.acceptDealBtn}
                  onClick={handleAccept}
                  disabled={isBusy}
                >
                  {isAgreed ? 'Proceed to Bag ↗' : 'Accept Deal ↗'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className={styles.footer}>
          {!isTerminal ? (
            <>
              {/* Quick AI & volume helpers */}
              <div className={styles.quickActions}>
                <button
                  type="button"
                  className={styles.actionPill}
                  onClick={handleSuggest}
                  disabled={isBusy}
                  title="Evaluation from shopping assistant"
                >
                  ⚡ Suggest Best Price
                </button>
                <button
                  type="button"
                  className={styles.actionPill}
                  onClick={handleAutoRun}
                  disabled={isBusy}
                  title="Multi-round autonomous bargaining"
                >
                  ⚡ Auto-Negotiate
                </button>
              </div>

              {/* Offer Form */}
              <form className={styles.inputForm} onSubmit={handlePropose}>
                <div className={styles.qtyAdjuster}>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={isBusy || quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className={styles.qtyDisplay}>{quantity}</span>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() => setQuantity((q) => Math.min(100, q + 1))}
                    disabled={isBusy || quantity >= 100}
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>

                <div className={styles.inputGroup}>
                  <span className={styles.currencyPrefix}>₹</span>
                  <input
                    type="number"
                    min="1"
                    className={styles.offerInput}
                    placeholder="Enter offer price per unit"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    disabled={isBusy}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className={styles.submitOfferBtn}
                  disabled={isBusy || !offerPrice}
                >
                  {isBusy ? 'Submitting...' : 'Propose Price'}
                </button>
              </form>
            </>
          ) : (
            <div className={styles.concludedNotice}>
              {status === 'AGREED'
                ? 'Deal confirmed! You can review and complete payment in your bag.'
                : 'This negotiation has concluded. You can start a fresh offer anytime.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
