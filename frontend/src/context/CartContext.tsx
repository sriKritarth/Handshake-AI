'use client';

import { createContext, useState, useEffect, useContext, type ReactNode } from 'react';

export interface NegotiatedDeal {
  sessionId: string;
  skuCode: string;
  name: string;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  imageUrl?: string | null;
}

export interface CartContextType {
  cart: Record<string, number>;
  deals: NegotiatedDeal[];
  saved: string[];
  addToCart: (skuCode: string, quantity?: number) => void;
  updateQuantity: (skuCode: string, delta: number) => void;
  removeFromCart: (skuCode: string) => void;
  addDeal: (deal: NegotiatedDeal) => void;
  removeDeal: (index: number) => void;
  toggleSave: (skuCode: string) => void;
  isSaved: (skuCode: string) => boolean;
  clearCart: () => void;
  cartCount: number;
  toastMessage: string | null;
  notify: (msg: string) => void;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [deals, setDeals] = useState<NegotiatedDeal[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Restore on client mount
  useEffect(() => {
    try {
      const storedCart = localStorage.getItem('handshake-cart-v1');
      if (storedCart) setCart(JSON.parse(storedCart));

      const storedDeals = localStorage.getItem('handshake-deals-v1');
      if (storedDeals) setDeals(JSON.parse(storedDeals));

      const storedSaved = localStorage.getItem('handshake-saved-v1');
      if (storedSaved) setSaved(JSON.parse(storedSaved));
    } catch {}
  }, []);

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('handshake-cart-v1', JSON.stringify(cart));
      localStorage.setItem('handshake-deals-v1', JSON.stringify(deals));
      localStorage.setItem('handshake-saved-v1', JSON.stringify(saved));
    } catch {}
  }, [cart, deals, saved]);

  const notify = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const addToCart = (skuCode: string, quantity = 1) => {
    setCart((prev) => ({
      ...prev,
      [skuCode]: (prev[skuCode] || 0) + quantity,
    }));
    notify('Added to cart');
  };

  const updateQuantity = (skuCode: string, delta: number) => {
    setCart((prev) => {
      const current = prev[skuCode] || 0;
      const next = current + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[skuCode];
        return copy;
      }
      return { ...prev, [skuCode]: next };
    });
  };

  const removeFromCart = (skuCode: string) => {
    setCart((prev) => {
      const copy = { ...prev };
      delete copy[skuCode];
      return copy;
    });
    notify('Removed from cart');
  };

  const addDeal = (deal: NegotiatedDeal) => {
    setDeals((prev) => [...prev, deal]);
    notify('Negotiated offer added to cart');
  };

  const removeDeal = (index: number) => {
    setDeals((prev) => prev.filter((_, i) => i !== index));
    notify('Offer removed from cart');
  };

  const toggleSave = (skuCode: string) => {
    setSaved((prev) => {
      const exists = prev.includes(skuCode);
      const next = exists ? prev.filter((code) => code !== skuCode) : [...prev, skuCode];
      notify(exists ? 'Removed from saved items' : 'Saved to your list');
      return next;
    });
  };

  const isSaved = (skuCode: string) => saved.includes(skuCode);

  const clearCart = () => {
    setCart({});
    setDeals([]);
    notify('Cart cleared');
  };

  const standardCount = Object.values(cart).reduce((sum, q) => sum + q, 0);
  const dealCount = deals.reduce((sum, d) => sum + d.quantity, 0);
  const cartCount = standardCount + dealCount;

  return (
    <CartContext.Provider
      value={{
        cart,
        deals,
        saved,
        addToCart,
        updateQuantity,
        removeFromCart,
        addDeal,
        removeDeal,
        toggleSave,
        isSaved,
        clearCart,
        cartCount,
        toastMessage,
        notify,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
