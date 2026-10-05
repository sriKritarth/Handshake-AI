import React, { Suspense, lazy, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Navbar } from "@/components/layout/Navbar";
import { CartDrawer } from "@/components/product/CartDrawer";
import { AuthModal } from "@/components/common/AuthModal";
import { useAppSelector } from "@/hooks/useRedux";
import { selectIsAuthenticated, selectCurrentUser } from "@/features/auth/authSlice";

// Route-level code-splitting with React.lazy
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage }))
);
const CatalogPage = lazy(() =>
  import("@/pages/CatalogPage").then((m) => ({ default: m.CatalogPage }))
);
const SessionRoomPage = lazy(() =>
  import("@/pages/SessionRoomPage").then((m) => ({ default: m.SessionRoomPage }))
);
const SessionsListPage = lazy(() =>
  import("@/pages/SessionsListPage").then((m) => ({ default: m.SessionsListPage }))
);
const MerchantDeskPage = lazy(() =>
  import("@/pages/MerchantDeskPage").then((m) => ({ default: m.MerchantDeskPage }))
);

export const App: React.FC = () => {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const currentUser = useAppSelector(selectCurrentUser);
  const isMerchant = currentUser?.role === "merchant";

  return (
    <BrowserRouter>
      <div className="flex min-h-screen flex-col bg-neutral-900 text-neutral-100 selection:bg-primary-500/20 selection:text-primary-300">
        <Navbar onOpenAuth={() => setIsAuthOpen(true)} />

        <main className="flex-1">
          <Suspense
            fallback={
              <div className="flex h-96 items-center justify-center text-xs font-mono text-neutral-500">
                Loading view...
              </div>
            }
          >
            <Routes>
              {/* Home Page: If not authenticated -> Login page with sign in/sign up options.
                  If authenticated as buyer -> Wholesale Catalog Storefront.
                  If authenticated as merchant -> Direct to Merchant Desk. */}
              <Route
                path="/"
                element={
                  isAuthenticated ? (
                    isMerchant ? (
                      <Navigate to="/merchant" replace />
                    ) : (
                      <CatalogPage onOpenAuth={() => setIsAuthOpen(true)} />
                    )
                  ) : (
                    <LoginPage />
                  )
                }
              />

              {/* Dedicated Login route */}
              <Route
                path="/login"
                element={
                  isAuthenticated ? (
                    <Navigate to={isMerchant ? "/merchant" : "/"} replace />
                  ) : (
                    <LoginPage />
                  )
                }
              />

              {/* Protected Routes */}
              <Route
                path="/sessions"
                element={
                  isAuthenticated ? (
                    <SessionsListPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />

              <Route
                path="/session/:session_id"
                element={
                  isAuthenticated ? (
                    <SessionRoomPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />

              <Route
                path="/merchant"
                element={
                  isAuthenticated ? (
                    <MerchantDeskPage />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />

              {/* 404 Fallback */}
              <Route
                path="*"
                element={
                  <div className="mx-auto max-w-md px-4 py-24 text-center">
                    <h2 className="text-3xl font-extrabold text-white">404</h2>
                    <p className="text-xs text-neutral-400 mt-2">Page does not exist.</p>
                    <Link
                      to={isMerchant ? "/merchant" : "/"}
                      className="mt-4 inline-block text-xs font-semibold text-primary-400 hover:underline"
                    >
                      Return to Home
                    </Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>

        {!isMerchant && isAuthenticated && <CartDrawer />}
        <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />

        <footer className="border-t border-white/10 bg-neutral-950/60 py-6 text-center text-xs text-neutral-500">
          <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span>© 2026 Handshake AI. Enterprise Wholesale Commerce Platform.</span>
            <span className="font-mono text-[11px] text-neutral-600">
              Verified Settlement & Compliance Engine
            </span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
};

export default App;
