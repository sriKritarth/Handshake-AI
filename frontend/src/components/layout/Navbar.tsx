import React from "react";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import { selectCartCount, setCartDrawer } from "@/features/cart/cartSlice";
import {
  selectCurrentUser,
  selectIsAuthenticated,
  logout,
} from "@/features/auth/authSlice";
import { ShoppingBag, Handshake, LogOut, User as UserIcon } from "lucide-react";

interface NavbarProps {
  onOpenAuth: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAuth }) => {
  const dispatch = useAppDispatch();
  const cartCount = useAppSelector(selectCartCount);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const currentUser = useAppSelector(selectCurrentUser);
  const isMerchant = currentUser?.role === "merchant";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-neutral-900/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand / Logo */}
        <div className="flex items-center gap-6">
          <Link to={isMerchant ? "/merchant" : "/"} className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/10 border border-primary-500/20 text-primary-400 group-hover:bg-primary-500/20 group-hover:border-primary-500/40 transition-all overflow-hidden p-0.5">
              <img
                src="https://res.cloudinary.com/v6jfwkvc/image/upload/f_auto,q_auto,w_100/v1791215720/handshake_ai_logo_512.png"
                alt="Handshake AI"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-extrabold tracking-tight text-white flex items-center gap-1.5">
                HANDSHAKE <span className="text-primary-400">AI</span>
              </span>
              <span className="text-[10px] font-mono tracking-wider text-neutral-400 uppercase -mt-0.5">
                {isMerchant ? "Seller Portal" : "Autonomous B2B"}
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
            {isMerchant ? (
              <>
                <Link
                  to="/merchant"
                  className="rounded-lg px-3 py-1.5 text-amber-300 font-semibold hover:bg-amber-400/10 transition-colors"
                >
                  Pending Approvals
                </Link>
                <Link
                  to="/sessions"
                  className="rounded-lg px-3 py-1.5 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  Store Deals
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/"
                  className="rounded-lg px-3 py-1.5 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  Wholesale Catalog
                </Link>
                {isAuthenticated && (
                  <Link
                    to="/sessions"
                    className="rounded-lg px-3 py-1.5 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors"
                  >
                    My Deals
                  </Link>
                )}
              </>
            )}
          </nav>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Cart Drawer Trigger: ONLY visible when authenticated as a buyer (hidden on sign-up / log-in) */}
          {isAuthenticated && currentUser?.role === "buyer" && (
            <button
              onClick={() => dispatch(setCartDrawer(true))}
              className="relative rounded-xl border border-white/10 bg-neutral-850 p-2.5 text-neutral-300 hover:border-white/20 hover:text-white transition-all active:scale-95"
              aria-label="View Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 font-mono text-[11px] font-bold text-neutral-950 animate-bump shadow-glow">
                  {cartCount}
                </span>
              )}
            </button>
          )}

          {/* Auth State */}
          {isAuthenticated && currentUser ? (
            <div className="flex items-center gap-2 pl-2 border-l border-white/10">
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-semibold text-neutral-200">
                  {currentUser.first_name} {currentUser.last_name}
                </span>
                <span
                  className={`font-mono text-[10px] uppercase ${
                    isMerchant ? "text-amber-400 font-bold" : "text-primary-400"
                  }`}
                >
                  {currentUser.role}
                </span>
              </div>
              <button
                onClick={() => dispatch(logout())}
                title="Log out"
                className="rounded-xl border border-white/10 bg-neutral-850 p-2.5 text-neutral-400 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 transition-all"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenAuth}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-neutral-850 px-3.5 py-2 text-xs font-semibold text-neutral-200 hover:bg-neutral-800 hover:text-white transition-all"
            >
              <UserIcon className="h-3.5 w-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
