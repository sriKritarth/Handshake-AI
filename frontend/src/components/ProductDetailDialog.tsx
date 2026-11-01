'use client';

import { useState, useEffect } from 'react';
import styles from './ProductDetailDialog.module.css';
import { useCatalogItem } from '../hooks/useCatalog';
import { useCart } from '../context/CartContext';
import { formatPrice } from '../api/client';
import { getOptimizedImageUrl, handleImageError } from '../utils/images';
import type { CatalogSku } from '../api/schemas';

export interface ProductDetailDialogProps {
  product: CatalogSku | null;
  onClose: () => void;
  onStartNegotiation: (product: CatalogSku, quantity: number) => void;
  onAddedToCart?: (productName: string) => void;
}

export function ProductDetailDialog({
  product: initialProduct,
  onClose,
  onStartNegotiation,
  onAddedToCart,
}: ProductDetailDialogProps) {
  const [quantity, setQuantity] = useState(1);

  // Direct SKU lookup for fresh inventory and pricing
  const { data: freshProduct } = useCatalogItem(initialProduct?.sku_code);
  const activeProduct = freshProduct || initialProduct;

  // Handle ESC key press
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    if (activeProduct) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProduct, onClose]);

  const { addToCart } = useCart();

  if (!activeProduct) return null;

  const imageUrl = getOptimizedImageUrl(
    activeProduct.secure_url || activeProduct.Image_url || activeProduct.image_url,
    800,
    activeProduct.name
  );

  const handleAddBag = () => {
    addToCart(activeProduct.sku_code, quantity);
    if (onAddedToCart) {
      onAddedToCart(activeProduct.name);
    }
    onClose();
  };

  const handleMakeOffer = () => {
    onStartNegotiation(activeProduct, quantity);
    onClose();
  };

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close dialog"
        >
          <svg viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className={styles.imageArea}>
          <img
            src={imageUrl}
            alt={activeProduct.name}
            className={styles.modalImg}
            onError={(e) => handleImageError(e, activeProduct.name)}
          />
        </div>

        <div className={styles.contentArea}>
          <span className={styles.categoryTag}>{activeProduct.category || 'General'}</span>
          <h2 id="product-title" className={styles.title}>
            {activeProduct.name}
          </h2>
          <div className={styles.itemId}>Item code: {activeProduct.sku_code}</div>

          <div className={styles.priceStrip}>
            <span className={styles.priceLabel}>Wholesale price:</span>
            <span className={styles.priceValue}>{formatPrice(activeProduct.base_price)}</span>
          </div>

          <div className={styles.wholesaleNote}>
            <svg viewBox="0 0 24 24">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <span>Volume discounts available on larger orders</span>
          </div>

          <p className={styles.desc}>
            {activeProduct.description ||
              'High-quality wholesale piece crafted with durable materials and verified origin.'}
          </p>

          <div className={styles.qtyRow}>
            <span className={styles.qtyLabel}>Quantity:</span>
            <div className={styles.qtyControls}>
              <button
                type="button"
                className={styles.qtyBtn}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                -
              </button>
              <span className={styles.qtyNum}>{quantity}</span>
              <button
                type="button"
                className={styles.qtyBtn}
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          </div>

          <div className={styles.buttonGroup}>
            <button type="button" className={styles.offerBtn} onClick={handleMakeOffer}>
              Make an offer
            </button>
            <button type="button" className={styles.addBagBtn} onClick={handleAddBag}>
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
