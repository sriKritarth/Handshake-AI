'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { CatalogSection } from '../components/CatalogSection';
import { ProductDetailDialog } from '../components/ProductDetailDialog';
import { AuthModal, type AuthMode } from '../components/AuthModal';
import { Footer } from '../components/Footer';
import type { CatalogSku } from '../api/schemas';

function HomeContent() {
  const searchParams = useSearchParams();

  const [onlySaved, setOnlySaved] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogSku | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthMode>('login');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * ALGORITHM: AutoOpenLoginAfterReset()
   * 2. In app/page.tsx on mount:
   *    - IF searchParams.get("auth") == "login":
   *         setAuthModalOpen(true)
   *         setAuthModalMode("login")
   */
  useEffect(() => {
    if (searchParams.get('auth') === 'login') {
      setAuthModalMode('login');
      setAuthModalOpen(true);
    }
  }, [searchParams]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  const handleSearchFocus = () => {
    if (searchInputRef.current) {
      searchInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      searchInputRef.current.focus();
    }
  };

  const handleStartNegotiation = (product: CatalogSku, quantity = 1) => {
    showToast(`Starting price negotiation for ${product.name} (${quantity} item${quantity === 1 ? '' : 's'})...`);
  };

  const handleAddedToCart = (productName: string) => {
    showToast(`Added ${productName} to your cart.`);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        onOpenAuth={() => {
          setAuthModalMode('login');
          setAuthModalOpen(true);
        }}
        onToggleSaved={() => setOnlySaved((prev) => !prev)}
        onlySaved={onlySaved}
        onSearchFocus={handleSearchFocus}
      />

      <main id="main-content" style={{ flex: 1 }}>
        <Hero />

        <CatalogSection
          searchInputRef={searchInputRef}
          onSelectProduct={(product) => setSelectedProduct(product)}
          onStartNegotiation={(product) => handleStartNegotiation(product)}
          onlySaved={onlySaved}
          onResetFilters={() => setOnlySaved(false)}
        />
      </main>

      <Footer />

      {/* Product Detail Dialog */}
      {selectedProduct && (
        <ProductDetailDialog
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onStartNegotiation={(product, qty) => handleStartNegotiation(product, qty)}
          onAddedToCart={handleAddedToCart}
        />
      )}

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
      />

      {/* Transient Action Feedback Toast */}
      {toastMessage && (
        <div className="toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
