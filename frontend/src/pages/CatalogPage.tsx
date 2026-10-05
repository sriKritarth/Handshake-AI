import React, { useState } from "react";
import { useGetCatalogQuery } from "@/features/api/apiSlice";
import { CatalogSku } from "@/types/api.types";
import { ProductCard } from "@/components/product/ProductCard";
import { SearchBar } from "@/components/product/SearchBar";
import { Skeleton } from "@/components/common/Skeleton";
import { NegotiationModal } from "@/components/product/NegotiationModal";
import { ShieldCheck, Sparkles, Zap, TrendingDown } from "lucide-react";

interface CatalogPageProps {
  onOpenAuth: () => void;
}

export const CatalogPage: React.FC<CatalogPageProps> = ({ onOpenAuth }) => {
  const { data: catalogData, isLoading, error } = useGetCatalogQuery();
  // All 75 catalog items have active verified pricing policies in the database
  const catalog = catalogData?.data || [];

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedProductForNegotiate, setSelectedProductForNegotiate] =
    useState<CatalogSku | null>(null);

  // Extract unique categories from active policy-backed items
  const categories = [
    "all",
    ...Array.from(new Set(catalog.map((i) => i.category))),
  ];

  const filteredCatalog =
    selectedCategory === "all"
      ? catalog
      : catalog.filter((i) => i.category === selectedCategory);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Editorial Hero Section */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-neutral-800/80 via-neutral-850 to-neutral-900/90 p-8 sm:p-12 mb-10 shadow-2xl">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary-500/30 bg-primary-500/10 px-3 py-1 text-xs font-semibold text-primary-400 mb-4">
            <Sparkles className="h-3.5 w-3.5 fill-current" />
            <span>Autonomous B2B Wholesale Platform</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            Wholesale Trading, <br />
            <span className="bg-gradient-to-r from-primary-400 via-emerald-300 to-teal-400 bg-clip-text text-transparent">
              Negotiated Instantly by AI.
            </span>
          </h1>

          <p className="mt-4 text-sm sm:text-base text-neutral-300 leading-relaxed max-w-xl">
            Direct inventory pricing backed by automated pricing agreements, volume tier savings, and verified order settlement.
          </p>

          <div className="mt-6 flex flex-wrap gap-4 text-xs font-semibold text-neutral-400">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary-400" />
              <span>Verified Order Settlement</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-primary-400" />
              <span>Dynamic Quantity Discounts</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary-400" />
              <span>Instant Deal Finalization</span>
            </div>
          </div>
        </div>

        {/* Decorative Grid Glow */}
        <div className="absolute top-0 right-0 -mt-16 -mr-16 h-96 w-96 rounded-full bg-primary-500/10 blur-3xl pointer-events-none" />
      </section>

      {/* Catalog Search & Category Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8">
        <SearchBar
          catalog={catalog}
          isLoading={isLoading}
          onSelectSku={(sku) => setSelectedProductForNegotiate(sku)}
        />

        {/* Filter Badges */}
        <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-xl px-3.5 py-2 text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap ${
                selectedCategory === cat
                  ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                  : "border border-white/10 bg-neutral-850 text-neutral-400 hover:border-white/20 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-white/10 bg-neutral-850/60 p-4"
            >
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <div className="mt-4 flex flex-col gap-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-red-400">
          <p className="font-semibold text-base">Unable to load product catalog</p>
          <p className="text-xs text-red-300/80 mt-1">
            Please check your connection and try refreshing in a moment.
          </p>
        </div>
      ) : filteredCatalog.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-850 p-12 text-center text-neutral-400">
          No products found matching the criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCatalog.map((product) => (
            <ProductCard
              key={product.sku_code}
              product={product}
              onNegotiate={(sku) => setSelectedProductForNegotiate(sku)}
            />
          ))}
        </div>
      )}

      {/* Negotiation Modal */}
      <NegotiationModal
        product={selectedProductForNegotiate}
        isOpen={Boolean(selectedProductForNegotiate)}
        onClose={() => setSelectedProductForNegotiate(null)}
        onRequireAuth={onOpenAuth}
      />
    </div>
  );
};
