'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header } from '../components/Header';
import { Hero } from '../components/Hero';
import { CatalogSection } from '../components/CatalogSection';
import { ProductDetailDialog } from '../components/ProductDetailDialog';
import { NegotiationDialog } from '../components/NegotiationDialog';
import { OffersDrawer } from '../components/OffersDrawer';
import { AuthModal, type AuthMode } from '../components/AuthModal';
import { Footer } from '../components/Footer';
import { useAuth } from '../context/AuthContext';
import { initializeNegotiationSession } from '../api/negotiation';
import type { CatalogSku } from '../api/schemas';

function HomeContent() {
  const searchParams = useSearchParams();
  const { isAuthenticated } = useAuth();

  const [onlySaved, setOnlySaved] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogSku | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthMode>('login');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Negotiation session state
  const [negotiationDialogOpen, setNegotiationDialogOpen] = useState(false);
  const [negotiationSessionId, setNegotiationSessionId] = useState<string | null>(null);
  const [negotiationProduct, setNegotiationProduct] = useState<CatalogSku | null>(null);
  const [negotiationQuantity, setNegotiationQuantity] = useState(1);
  const [isSessionInitializing, setIsSessionInitializing] = useState(false);

  // Offers drawer state
  const [offersDrawerOpen, setOffersDrawerOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * ALGORITHM: AutoOpenLoginAfterReset()
   * In app/page.tsx on mount:
   * IF searchParams.get("auth") == "login": setAuthModalOpen(true)
   */
  useEffect(() => {
    if (searchParams.get('auth') === 'login') {
      setAuthModalMode('login');
      setAuthModalOpen(true);
    }
  }, [searchParams]);

  // Check pending negotiation after login
  useEffect(() => {
    if (isAuthenticated) {
      try {
        const pendingRaw = sessionStorage.getItem('pending_negotiation');
        if (pendingRaw) {
          sessionStorage.removeItem('pending_negotiation');
          const pending = JSON.parse(pendingRaw);
          if (pending?.product) {
            handleStartNegotiation(pending.product, pending.requestedQty || 1);
          }
        }
      } catch {}
    }
  }, [isAuthenticated]);

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

  /**
   * Task 1: POST /api/v1/sessions
   * ALGORITHM: InitializeNegotiationSession(skuCode, requestedQty)
   */
  const handleStartNegotiation = async (product: CatalogSku, quantity = 1) => {
    // 1. Double-click state lock
    if (isSessionInitializing) return;

    // 2. Pre-flight authentication check
    if (!isAuthenticated) {
      try {
        sessionStorage.setItem(
          'pending_negotiation',
          JSON.stringify({
            skuCode: product.sku_code,
            requestedQty: quantity,
            product,
          })
        );
      } catch {}

      setAuthModalMode('login');
      setAuthModalOpen(true);
      showToast('Please sign in to make a price offer.');
      return;
    }

    setIsSessionInitializing(true);
    showToast(`Starting negotiation for ${product.name}...`);

    try {
      const res = await initializeNegotiationSession(product.sku_code, quantity);
      setNegotiationProduct(product);
      setNegotiationQuantity(quantity);
      setNegotiationSessionId(res.session_id);
      setNegotiationDialogOpen(true);
    } catch (err: any) {
      showToast(err.message || 'Could not start negotiation.');
    } finally {
      setIsSessionInitializing(false);
    }
  };

  const handleResumeSession = (sessionId: string, skuCode: string) => {
    setNegotiationSessionId(sessionId);
    // If we have selected product or match sku, use it, else synthesize placeholder
    const matchedProduct = selectedProduct?.sku_code === skuCode ? selectedProduct : {
      sku_code: skuCode,
      name: 'Curated Wholesale Item',
      base_price: 0,
      description: '',
      inventory_count: 50,
      is_active: true,
      category: 'Wholesale',
    };

    setNegotiationProduct(matchedProduct as CatalogSku);
    setNegotiationDialogOpen(true);
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
        onOpenOffers={() => setOffersDrawerOpen(true)}
        onToggleSaved={() => setOnlySaved((prev) => !prev)}
        onlySaved={onlySaved}
        onSearchFocus={handleSearchFocus}
      />

      <main id="main-content" style={{ flex: 1 }}>
        <Hero />

        <CatalogSection
          searchInputRef={searchInputRef}
          onSelectProduct={(product) => setSelectedProduct(product)}
          onStartNegotiation={(product) => handleStartNegotiation(product, 1)}
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

      {/* Negotiation Dialog (Tasks 1, 3, 4, 5, 6, 7, 8, 9) */}
      <NegotiationDialog
        isOpen={negotiationDialogOpen}
        sessionId={negotiationSessionId}
        product={negotiationProduct}
        initialQuantity={negotiationQuantity}
        onClose={() => {
          setNegotiationDialogOpen(false);
          setNegotiationSessionId(null);
        }}
        onOpenAuth={() => {
          setAuthModalMode('login');
          setAuthModalOpen(true);
        }}
      />

      {/* Buyer Offers Drawer (Task 2) */}
      <OffersDrawer
        isOpen={offersDrawerOpen}
        onClose={() => setOffersDrawerOpen(false)}
        onResumeSession={handleResumeSession}
      />

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
