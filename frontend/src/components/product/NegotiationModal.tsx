import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/common/Modal";
import { CatalogSku } from "@/types/api.types";
import { useCreateSessionMutation } from "@/features/api/apiSlice";
import { useAppSelector } from "@/hooks/useRedux";
import { selectIsAuthenticated } from "@/features/auth/authSlice";
import { Button } from "@/components/common/Button";
import { getProductImage } from "@/utils/images";
import { toClientFriendlyMessage } from "@/utils/clientError";
import { Sparkles, Bot, AlertCircle } from "lucide-react";

interface NegotiationModalProps {
  product: CatalogSku | null;
  isOpen: boolean;
  onClose: () => void;
  onRequireAuth: () => void;
}

export const NegotiationModal: React.FC<NegotiationModalProps> = ({
  product,
  isOpen,
  onClose,
  onRequireAuth,
}) => {
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [quantity, setQuantity] = useState<string>("25");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [createSession, { isLoading }] = useCreateSessionMutation();

  if (!product) return null;

  const parsedQty = parseInt(quantity, 10);
  const validQty = !isNaN(parsedQty) && parsedQty > 0 ? parsedQty : 0;
  const estimatedTotal = product.base_price * validQty;

  const handleStart = async () => {
    if (!isAuthenticated) {
      onClose();
      onRequireAuth();
      return;
    }

    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg("Please enter a valid positive quantity (at least 1 unit)");
      return;
    }

    try {
      const res = await createSession({
        sku_code: product.sku_code,
        quantity: parsedQty,
      }).unwrap();

      onClose();
      navigate(`/session/${res.session_id}`);
    } catch (err: any) {
      setErrorMsg(toClientFriendlyMessage(err, "Failed to start negotiation session. Please try again."));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Start Autonomous Negotiation"
      description="Connect directly with the Seller AI Agent to secure quantity-based discounts."
    >
      <div className="flex flex-col gap-4">
        {/* Product Snippet */}
        <div className="flex items-center gap-3.5 rounded-xl bg-neutral-900/60 p-3 border border-white/5">
          <img
            src={getProductImage(product.sku_code, product.category, product.name, product.Image_url, 200)}
            alt={product.name}
            className="h-16 w-16 rounded-lg object-cover bg-neutral-800"
          />
          <div className="flex flex-col">
            <span className="text-[10px] text-primary-400 uppercase font-semibold">
              {product.category}
            </span>
            <span className="text-sm font-bold text-neutral-100">{product.name}</span>
            <span className="text-xs text-neutral-400">
              List Price: <strong className="text-neutral-200">₹{product.base_price.toLocaleString("en-IN")}</strong> / unit
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Quantity Selection */}
        <div>
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
            Negotiation Lot Quantity (Units)
          </label>
          <div className="flex items-center gap-2">
            {[10, 25, 50, 100].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setQuantity(String(qty));
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-mono font-semibold transition-all ${
                  parsedQty === qty
                    ? "border-primary-500 bg-primary-500/15 text-primary-400"
                    : "border-white/10 bg-neutral-900 text-neutral-400 hover:text-white"
                }`}
              >
                {qty} units
              </button>
            ))}
          </div>

          <div className="mt-2.5">
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => {
                setErrorMsg(null);
                setQuantity(e.target.value);
              }}
              className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2 font-mono text-sm text-neutral-100 outline-none focus:border-primary-500"
              placeholder="Enter custom quantity"
            />
          </div>
        </div>

        {/* Outlay Projection */}
        <div className="rounded-xl bg-neutral-900/80 p-3.5 border border-white/5 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
              Starting Total (Before Discount)
            </span>
            <div className="font-mono text-lg font-bold text-neutral-100">
              ₹{estimatedTotal.toLocaleString("en-IN")}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-primary-400 bg-primary-500/10 px-2.5 py-1 rounded-full border border-primary-500/20">
            <Bot className="h-3.5 w-3.5" />
            <span>AI Ready</span>
          </div>
        </div>

        <Button
          onClick={handleStart}
          isLoading={isLoading}
          className="w-full py-3 gap-2"
        >
          <Sparkles className="h-4 w-4 fill-current" />
          <span>Launch Negotiation Room</span>
        </Button>
      </div>
    </Modal>
  );
};
