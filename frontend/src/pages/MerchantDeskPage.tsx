import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  useGetPendingApprovalsQuery,
  useSubmitMerchantDecisionMutation,
  useListSessionsQuery,
} from "@/features/api/apiSlice";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import { toClientFriendlyMessage } from "@/utils/clientError";
import {
  Check,
  X,
  Clock,
  ArrowRight,
  TrendingDown,
  FileCheck,
  AlertCircle,
  Eye,
} from "lucide-react";

export const MerchantDeskPage: React.FC = () => {
  const {
    data: pendingData,
    isLoading: isPendingLoading,
    refetch: refetchPending,
  } = useGetPendingApprovalsQuery(undefined, {
    pollingInterval: 4000,
  });
  const approvals = pendingData?.data || [];

  const { data: allDealsData, isLoading: isDealsLoading } = useListSessionsQuery(
    undefined,
    { pollingInterval: 6000 }
  );
  const deals = allDealsData?.data || [];

  const [submitDecision, { isLoading: isSubmitting }] =
    useSubmitMerchantDecisionMutation();

  const [activeTab, setActiveTab] = useState<"pending" | "deals">("pending");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [counterPrice, setCounterPrice] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleAction = async (
    sessionId: string,
    action: "approve" | "reject" | "counter",
    price?: number
  ) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await submitDecision({
        session_id: sessionId,
        action,
        counter_price: price,
        merchant_notes: notes.trim() || undefined,
      }).unwrap();

      setSuccessMsg(
        action === "approve"
          ? "Customer's requested price has been approved!"
          : action === "counter"
          ? "Your counter-offer has been sent to the buyer."
          : "The request has been declined."
      );
      setSelectedSessionId(null);
      setCounterPrice("");
      setNotes("");
      refetchPending();
    } catch (err: any) {
      setErrorMsg(
        toClientFriendlyMessage(err, "Failed to process your decision. Please try again.")
      );
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 mb-2">
            <Clock className="h-3.5 w-3.5" />
            <span>Merchant Management Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Seller Approval Desk
          </h1>
          <p className="text-xs sm:text-sm text-neutral-400 mt-1">
            Review customer bulk discount requests and oversee store transactions.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex rounded-xl bg-neutral-850 p-1 border border-white/10 self-start sm:self-auto">
          <button
            onClick={() => setActiveTab("pending")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "pending"
                ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            <span>Action Required</span>
            {approvals.length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-neutral-950 text-[10px] font-bold">
                {approvals.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("deals")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
              activeTab === "deals"
                ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                : "text-neutral-400 hover:text-white"
            }`}
          >
            All Store Deals
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400 mb-6 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300 mb-6 flex items-center gap-2">
          <FileCheck className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {activeTab === "pending" ? (
        /* PENDING APPROVALS QUEUE */
        <div>
          {isPendingLoading ? (
            <div className="py-16 text-center text-sm text-neutral-400">
              Checking for pending discount requests...
            </div>
          ) : approvals.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-neutral-850 p-16 text-center text-neutral-400">
              <Clock className="h-10 w-10 text-neutral-600 mx-auto mb-3" />
              <h3 className="font-bold text-base text-neutral-200">
                All Caught Up!
              </h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm mx-auto">
                There are no buyer requests waiting for your approval right now.
                New discount requests will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {approvals.map((req) => (
                <div
                  key={req.id}
                  className="rounded-2xl border border-white/10 bg-neutral-850 p-6 shadow-xl transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-mono text-neutral-500">
                          Order Ref: {req.session_id.slice(0, 13)}
                        </span>
                        <span className="text-xs text-neutral-600">•</span>
                        <span className="text-xs text-amber-400">
                          Awaiting your price decision
                        </span>
                      </div>
                      <div className="text-lg font-bold text-white">
                        Customer Requested Price:{" "}
                        <span className="font-mono text-amber-400 text-xl font-bold ml-1">
                          ₹{req.requested_price.toLocaleString("en-IN")}
                        </span>
                        <span className="text-xs text-neutral-400 font-normal"> / unit</span>
                      </div>
                    </div>

                    <Badge variant="warning">Action Needed</Badge>
                  </div>

                  {selectedSessionId === req.session_id ? (
                    /* Counter proposal form */
                    <div className="rounded-xl bg-neutral-900/90 p-5 border border-white/5 animate-fadeIn">
                      <span className="text-xs font-semibold text-neutral-200 block mb-2">
                        Propose Alternate Counter Price to Buyer
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-[11px] text-neutral-400 mb-1">
                            Your Counter Price (₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={counterPrice}
                            onChange={(e) => setCounterPrice(e.target.value)}
                            placeholder="e.g. 1250"
                            className="w-full rounded-xl border border-white/10 bg-neutral-850 px-3.5 py-2 font-mono text-sm text-neutral-100 outline-none focus:border-amber-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-neutral-400 mb-1">
                            Note for Buyer (Optional)
                          </label>
                          <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. Best price we can offer for this volume"
                            className="w-full rounded-xl border border-white/10 bg-neutral-850 px-3.5 py-2 text-xs text-neutral-100 outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSessionId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={isSubmitting}
                          onClick={() =>
                            handleAction(
                              req.session_id,
                              "counter",
                              parseFloat(counterPrice)
                            )
                          }
                          className="bg-amber-400 hover:bg-amber-300 text-neutral-950 font-bold"
                        >
                          Send Counter Offer
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Action buttons */
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="text-xs text-neutral-400">
                        Received: {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • 30-minute approval window
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          isLoading={isSubmitting}
                          onClick={() => handleAction(req.session_id, "approve")}
                          className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold gap-1.5"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve Requested Price</span>
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedSessionId(req.session_id);
                            setCounterPrice(String(req.requested_price + 50));
                          }}
                          className="text-xs"
                        >
                          Make Counter Offer
                        </Button>

                        <Button
                          size="sm"
                          variant="danger"
                          isLoading={isSubmitting}
                          onClick={() => handleAction(req.session_id, "reject")}
                          className="gap-1.5"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Decline</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ALL STORE DEALS OVERVIEW */
        <div>
          {isDealsLoading ? (
            <div className="py-16 text-center text-sm text-neutral-400">
              Loading store deals...
            </div>
          ) : deals.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-neutral-850 p-16 text-center text-neutral-400">
              <p className="font-semibold text-neutral-200">No deals on record yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {deals.map((deal) => (
                <div
                  key={deal.session_id}
                  className="rounded-2xl border border-white/10 bg-neutral-850 p-5"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-xs uppercase text-primary-400 font-bold">
                      {deal.sku_code || "SKU"}
                    </span>
                    <Badge
                      variant={
                        deal.status === "AGREED"
                          ? "success"
                          : deal.status === "REJECTED"
                          ? "danger"
                          : "default"
                      }
                    >
                      {deal.status.replace("_", " ")}
                    </Badge>
                  </div>

                  <h3 className="text-base font-bold text-white mb-3">
                    {deal.product_name || "Wholesale Order"}
                  </h3>

                  <div className="flex items-center justify-between text-xs border-t border-white/5 pt-3 text-neutral-400">
                    <div>
                      <span>Settled Price: </span>
                      <strong className="text-neutral-100 font-mono">
                        ₹{(deal.final_agreed_price || deal.latest_seller_price || deal.base_price || 0).toLocaleString("en-IN")}
                      </strong>
                    </div>

                    <Link
                      to={`/session/${deal.session_id}`}
                      className="inline-flex items-center gap-1 text-primary-400 hover:text-primary-300 font-semibold"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Inspect Record</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
