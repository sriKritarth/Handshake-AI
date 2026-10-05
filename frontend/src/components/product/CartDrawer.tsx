import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import {
  selectCartItems,
  selectIsCartOpen,
  selectCartSubtotal,
  selectFreeShippingProgress,
  setCartDrawer,
  updateQuantity,
  removeFromCart,
  clearCart,
} from "@/features/cart/cartSlice";
import { useCheckoutCartMutation } from "@/features/api/apiSlice";
import { X, Minus, Plus, ShoppingBag, ArrowRight, Sparkles, Check, Loader2 } from "lucide-react";
import { getProductImage, optimizeCloudinaryUrl } from "@/utils/images";
import { toClientFriendlyMessage } from "@/utils/clientError";

export const CartDrawer: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isOpen = useAppSelector(selectIsCartOpen);
  const items = useAppSelector(selectCartItems);
  const subtotal = useAppSelector(selectCartSubtotal);
  const { progress, remaining, isFree } = useAppSelector(selectFreeShippingProgress);
  const drawerRef = useRef<HTMLDivElement>(null);

  const [checkoutCart, { isLoading: isCheckingOut }] = useCheckoutCartMutation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Close on Escape key & trap body scroll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch(setCartDrawer(false));
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, dispatch]);

  if (!isOpen) return null;

  // Direct purchase of a single item without negotiation: creates Razorpay order and opens payment checkout
  const handleDirectBuy = async (sku_code: string, quantity: number, unit_price: number) => {
    setErrorMsg(null);
    setIsProcessing(true);
    try {
      const res = await checkoutCart({
        items: [{ sku_code, quantity, unit_price }],
      }).unwrap();

      if (res.payment_url) {
        dispatch(removeFromCart(sku_code));
        dispatch(setCartDrawer(false));
        // Direct redirect straight to payment settlement without negotiation
        window.location.href = res.payment_url;
      } else {
        throw new Error("Payment gateway URL not received from server");
      }
    } catch (err: any) {
      setErrorMsg(toClientFriendlyMessage(err, "Failed to process direct order. Please try again."));
    } finally {
      setIsProcessing(false);
    }
  };

  // Direct checkout of all items in cart: calculates all items, creates Razorpay order, goes straight to payment
  const handleBuyAll = async () => {
    if (items.length === 0) return;
    setErrorMsg(null);
    setIsProcessing(true);
    try {
      const cartItemsPayload = items.map((item) => ({
        sku_code: item.sku_code,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));

      const res = await checkoutCart({
        items: cartItemsPayload,
      }).unwrap();

      if (res.payment_url) {
        dispatch(clearCart());
        dispatch(setCartDrawer(false));
        // Direct redirect straight to payment settlement without negotiation
        window.location.href = res.payment_url;
      } else {
        throw new Error("Payment gateway URL not received from server");
      }
    } catch (err: any) {
      setErrorMsg(toClientFriendlyMessage(err, "Failed to initiate cart checkout. Please try again."));
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        ref={drawerRef}
        className="w-full max-w-md bg-neutral-850 border-l border-white/10 p-6 flex flex-col justify-between shadow-2xl animate-slideLeft text-neutral-100"
      >
        {/* Top Header */}
        <div>
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <ShoppingBag className="h-5 w-5 text-primary-400" />
              <h2 className="text-lg font-bold tracking-tight">Your Cart</h2>
              <span className="rounded-full bg-neutral-750 px-2 py-0.5 text-xs text-neutral-300 font-mono">
                {items.length}
              </span>
            </div>
            <button
              onClick={() => dispatch(setCartDrawer(false))}
              className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-750 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {errorMsg && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
              {errorMsg}
            </div>
          )}

          {/* Free Shipping Progress Indicator */}
          <div className="mt-4 rounded-xl bg-neutral-900/70 p-3.5 border border-white/5">
            <p className="text-xs text-neutral-300 mb-1.5 flex justify-between">
              <span>
                {isFree ? (
                  <strong className="text-primary-400 font-semibold">
                    ✓ Free Delivery Unlocked!
                  </strong>
                ) : (
                  <>
                    Add <strong className="text-neutral-100 font-mono">₹{remaining.toLocaleString("en-IN")}</strong> more for Free Delivery
                  </>
                )}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">{Math.round(progress)}%</span>
            </p>
            <div className="h-1.5 w-full rounded-full bg-neutral-750 overflow-hidden">
              <div
                className="h-full bg-primary-500 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Cart Item Rows */}
          <div className="mt-5 flex flex-col gap-3.5 max-h-[48vh] overflow-y-auto pr-1">
            {items.length === 0 ? (
              <div className="py-16 text-center text-sm text-neutral-400 flex flex-col items-center gap-2">
                <ShoppingBag className="h-8 w-8 text-neutral-600 stroke-[1.5]" />
                <p>Your cart is empty.</p>
                <span className="text-xs text-neutral-500">
                  Add products directly from the catalog anytime.
                </span>
              </div>
            ) : (
              items.map((item) => {
                const rawImg = item.image || getProductImage(item.sku_code, item.category, item.name, undefined, 150);
                const img = optimizeCloudinaryUrl(rawImg, 150);
                return (
                  <div
                    key={item.sku_code}
                    className="flex flex-col gap-2.5 rounded-xl bg-neutral-900/60 p-3.5 border border-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={img}
                        alt={item.name}
                        width={60}
                        height={60}
                        className="h-14 w-14 rounded-lg object-cover bg-neutral-800 flex-shrink-0"
                      />

                      <div className="flex flex-col flex-1 min-w-0">
                        {item.category && (
                          <span className="text-[10px] uppercase text-primary-400 font-semibold tracking-wider">
                            {item.category}
                          </span>
                        )}
                        <span className="text-sm font-semibold truncate text-neutral-100">
                          {item.name}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs font-mono font-bold text-white">
                            ₹{(item.unit_price * item.quantity).toLocaleString("en-IN")}
                          </span>
                          <span className="text-[11px] text-neutral-500">
                            (₹{item.unit_price.toLocaleString("en-IN")} each)
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center rounded-lg border border-white/10 bg-neutral-800">
                          <button
                            onClick={() =>
                              dispatch(
                                updateQuantity({
                                  sku_code: item.sku_code,
                                  quantity: item.quantity - 1,
                                })
                              )
                            }
                            className="p-1 hover:text-white text-neutral-400"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-6 text-center font-mono text-xs">{item.quantity}</span>
                          <button
                            onClick={() =>
                              dispatch(
                                updateQuantity({
                                  sku_code: item.sku_code,
                                  quantity: item.quantity + 1,
                                })
                              )
                            }
                            className="p-1 hover:text-white text-neutral-400"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <button
                          onClick={() => dispatch(removeFromCart(item.sku_code))}
                          className="text-neutral-500 hover:text-red-400 p-1 transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Instant Buy button per cart item */}
                    <div className="flex items-center justify-between border-t border-white/5 pt-2">
                      <button
                        onClick={() => {
                          dispatch(setCartDrawer(false));
                          navigate(`/`);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-400 transition-colors"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>Negotiate Volume Discount</span>
                      </button>

                      <button
                        disabled={isProcessing || isCheckingOut}
                        onClick={() => handleDirectBuy(item.sku_code, item.quantity, item.unit_price)}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-neutral-200 hover:bg-primary-500 hover:text-neutral-950 transition-all active:scale-95 disabled:opacity-50"
                      >
                        {isProcessing || isCheckingOut ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Processing...</span>
                          </>
                        ) : (
                          <>
                            <span>Buy at Listed Price</span>
                            <ArrowRight className="h-3 w-3" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Bottom Checkout Section */}
        <div className="border-t border-white/10 pt-4">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-neutral-400">Total</span>
            <span className="text-xl font-bold font-mono text-neutral-100">
              ₹{subtotal.toLocaleString("en-IN")}
            </span>
          </div>

          <button
            disabled={items.length === 0 || isProcessing || isCheckingOut}
            onClick={handleBuyAll}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary-500 py-3.5 text-sm font-bold text-neutral-950 shadow-glow transition-all hover:bg-primary-400 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          >
            {isProcessing || isCheckingOut ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Creating Razorpay Order...</span>
              </>
            ) : (
              <>
                <span>Checkout & Place Order</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
