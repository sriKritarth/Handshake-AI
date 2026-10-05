import React, { memo } from "react";
import { CatalogSku } from "@/types/api.types";
import { useAppDispatch, useAppSelector } from "@/hooks/useRedux";
import { addToCart } from "@/features/cart/cartSlice";
import { selectUserRole } from "@/features/auth/authSlice";
import { getProductImage } from "@/utils/images";
import { Sparkles, ShoppingCart, Check } from "lucide-react";

interface ProductCardProps {
  product: CatalogSku;
  onNegotiate: (sku: CatalogSku) => void;
}

export const ProductCard: React.FC<ProductCardProps> = memo(
  ({ product, onNegotiate }) => {
    const dispatch = useAppDispatch();
    const userRole = useAppSelector(selectUserRole);
    const imageUrl = getProductImage(
      product.sku_code,
      product.category,
      product.name,
      product.Image_url
    );
    const isMerchant = userRole === "merchant";

    return (
      <article className="group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-neutral-850/70 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-primary-500/40 hover:shadow-card">
        {/* Media Container with CLS-proof Aspect Ratio */}
        <div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-900 border border-white/5">
            <img
              src={imageUrl}
              alt={product.name}
              width={600}
              height={450}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            />
            <div className="absolute top-2.5 right-2.5 rounded-full bg-neutral-900/80 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-neutral-300 backdrop-blur-md border border-white/10">
              {product.category}
            </div>
          </div>

          {/* Metadata */}
          <div className="mt-4 flex flex-col gap-1">
            <h3 className="text-base font-semibold text-neutral-100 group-hover:text-primary-400 transition-colors line-clamp-1">
              {product.name}
            </h3>
            <p className="line-clamp-2 text-xs text-neutral-400 leading-relaxed min-h-[32px]">
              {product.description}
            </p>
          </div>
        </div>

        {/* Pricing and Action Section */}
        <div className="mt-5 border-t border-white/5 pt-3.5 flex items-center justify-between">
          <div>
            <span className="block text-[10px] uppercase font-bold tracking-wider text-neutral-500">
              Wholesale Price
            </span>
            <span className="text-lg font-bold text-neutral-100 font-mono">
              ₹{product.base_price.toLocaleString("en-IN")}
            </span>
          </div>

          {!isMerchant ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  dispatch(
                    addToCart({
                      sku_code: product.sku_code,
                      name: product.name,
                      unit_price: product.base_price,
                      quantity: 1,
                      category: product.category,
                      image: imageUrl,
                    })
                  )
                }
                title="Add to cart without negotiation"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-xs font-semibold text-neutral-200 transition-all hover:bg-neutral-700 hover:text-white active:scale-95"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span>Add to Cart</span>
              </button>

              <button
                onClick={() => onNegotiate(product)}
                title="Negotiate custom bulk discount"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-3 py-2 text-xs font-bold text-neutral-950 shadow-glow transition-all hover:bg-primary-400 active:scale-95"
              >
                <Sparkles className="h-3.5 w-3.5 fill-current" />
                <span>Negotiate</span>
              </button>
            </div>
          ) : (
            <span className="rounded-lg bg-neutral-800 border border-white/5 px-2.5 py-1 text-[11px] font-mono text-neutral-400">
              Merchant View
            </span>
          )}
        </div>
      </article>
    );
  }
);
