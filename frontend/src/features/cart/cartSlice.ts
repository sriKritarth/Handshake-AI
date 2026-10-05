import { createSlice, createSelector, PayloadAction } from "@reduxjs/toolkit";

export interface CartItem {
  sku_code: string;
  name: string;
  unit_price: number;
  quantity: number;
  category?: string;
  image?: string;
}

interface CartState {
  items: CartItem[];
  isDrawerOpen: boolean;
}

const getInitialCart = (): CartItem[] => {
  try {
    const saved = localStorage.getItem("cart_items");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const initialState: CartState = {
  items: getInitialCart(),
  isDrawerOpen: false,
};

export const cartSlice = createSlice({
  name: "cart",
  initialState,
  reducers: {
    addToCart: (state, action: PayloadAction<CartItem>) => {
      const existingIndex = state.items.findIndex(
        (i) => i.sku_code === action.payload.sku_code
      );
      if (existingIndex > -1) {
        state.items[existingIndex].quantity += action.payload.quantity;
      } else {
        state.items.push(action.payload);
      }
      state.isDrawerOpen = true;
    },
    updateQuantity: (
      state,
      action: PayloadAction<{ sku_code: string; quantity: number }>
    ) => {
      const item = state.items.find((i) => i.sku_code === action.payload.sku_code);
      if (item) {
        if (action.payload.quantity <= 0) {
          state.items = state.items.filter((i) => i.sku_code !== action.payload.sku_code);
        } else {
          item.quantity = action.payload.quantity;
        }
      }
    },
    removeFromCart: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter((i) => i.sku_code !== action.payload);
    },
    clearCart: (state) => {
      state.items = [];
    },
    setCartDrawer: (state, action: PayloadAction<boolean>) => {
      state.isDrawerOpen = action.payload;
    },
  },
});

export const {
  addToCart,
  updateQuantity,
  removeFromCart,
  clearCart,
  setCartDrawer,
} = cartSlice.actions;

// Selectors
export const selectCartItems = (state: { cart: CartState }) => state.cart.items;
export const selectIsCartOpen = (state: { cart: CartState }) => state.cart.isDrawerOpen;

export const selectCartSubtotal = createSelector([selectCartItems], (items) =>
  items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
);

export const selectCartCount = createSelector([selectCartItems], (items) =>
  items.reduce((count, item) => count + item.quantity, 0)
);

export const selectFreeShippingProgress = createSelector(
  [selectCartSubtotal],
  (subtotal) => {
    const FREE_SHIPPING_THRESHOLD = 5000;
    const progress = Math.min((subtotal / FREE_SHIPPING_THRESHOLD) * 100, 100);
    const remaining = Math.max(FREE_SHIPPING_THRESHOLD - subtotal, 0);
    return { progress, remaining, isFree: remaining === 0 };
  }
);
