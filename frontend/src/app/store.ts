import { configureStore, Middleware } from "@reduxjs/toolkit";
import { apiSlice } from "@/features/api/apiSlice";
import { cartSlice } from "@/features/cart/cartSlice";
import { authSlice } from "@/features/auth/authSlice";

// Custom ultra-lean localStorage sync middleware for cart
const localStorageMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  const state = store.getState() as RootState;
  try {
    localStorage.setItem("cart_items", JSON.stringify(state.cart.items));
  } catch {
    // quota exceeded or private mode safeguard
  }
  return result;
};

export const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    cart: cartSlice.reducer,
    auth: authSlice.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(apiSlice.middleware, localStorageMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
