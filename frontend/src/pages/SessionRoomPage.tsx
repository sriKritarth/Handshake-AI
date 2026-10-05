import React, { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  useGetSessionQuery,
  useGetCheckoutDetailsQuery,
  useSubmitBuyerMoveMutation,
  useAcceptOfferMutation,
  useDeclineOfferMutation,
  useA2aStepMutation,
  useA2aAutoRunMutation,
} from "@/features/api/apiSlice";
import { useAppSelector } from "@/hooks/useRedux";
import { selectUserRole } from "@/features/auth/authSlice";
import { isSessionPaid, markSessionPaid } from "@/utils/paidStorage";
import { toClientFriendlyMessage } from "@/utils/clientError";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import {
  Bot,
  User,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Play,
  Sparkles,
  ExternalLink,
  Package,
  Receipt,
  FileCheck,
  Printer,
  Clock,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export const SessionRoomPage: React.FC = () => {
  const { session_id = "" } = useParams<{ session_id: string }>();
  const [searchParams] = useSearchParams();
  const isPaidQuery = searchParams.get("paid") === "true";
  const paymentIdQuery = searchParams.get("payment_id") || undefined;
  const userRole = useAppSelector(selectUserRole);
  const isMerchant = userRole === "merchant";

  // Poll session state every 3 seconds while active
  const { data: sessionData, isLoading, refetch } = useGetSessionQuery(session_id, {
    pollingInterval: 3000,
  });
  const session = sessionData?.data;

  // Poll payment & checkout status
  const { data: checkoutData } = useGetCheckoutDetailsQuery(session_id, {
    skip: !session_id || session?.status !== "AGREED",
    pollingInterval: 3000,
  });

  // Track paid status across query params, polling, and local cache
  useEffect(() => {
    if (isPaidQuery && session_id) {
      markSessionPaid(session_id, paymentIdQuery);
    }
  }, [isPaidQuery, session_id, paymentIdQuery]);

  useEffect(() => {
    if (checkoutData?.data?.payment_status === "PAID" && session_id) {
      markSessionPaid(session_id);
    }
  }, [checkoutData, session_id]);

  const isLocallyPaid = isSessionPaid(session_id);
  const isPaid =
    isLocallyPaid ||
    checkoutData?.data?.payment_status === "PAID" ||
    session?.status === "PAID" ||
    isPaidQuery;

  // Buyer action mutations
  const [submitMove, { isLoading: isMoveLoading }] = useSubmitBuyerMoveMutation();
  const [acceptDeal, { isLoading: isAcceptLoading }] = useAcceptOfferMutation();
  const [declineDeal, { isLoading: isDeclineLoading }] = useDeclineOfferMutation();
  const [runA2aStep, { isLoading: isA2aStepLoading }] = useA2aStepMutation();
  const [runA2aLoop, { isLoading: isA2aLoopLoading }] = useA2aAutoRunMutation();

  const [counterPrice, setCounterPrice] = useState<string>("");
  const [counterQuantity, setCounterQuantity] = useState<string>("");
  const [buyerMessage, setBuyerMessage] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-sync initial quantity from session
  useEffect(() => {
    if (session?.quantity && !counterQuantity) {
      setCounterQuantity(String(session.quantity));
    }
  }, [session?.quantity]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-neutral-400">
        Loading deal room...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h2 className="text-lg font-bold text-neutral-100">Deal Not Found</h2>
        <p className="text-xs text-neutral-400 mt-2">
          This negotiation record does not exist or you do not have permission to view it.
        </p>
        <Link to="/" className="mt-4 inline-block text-xs font-semibold text-primary-400">
          Return to Catalog
        </Link>
      </div>
    );
  }

  const isTerminal = ["AGREED", "REJECTED", "EXPIRED", "PENDING_APPROVAL"].includes(session.status);
  const isFinalOffer = session.status === "FINAL_OFFER";

  const formatErrorMessage = (err: any, fallback: string) => {
    return toClientFriendlyMessage(err, fallback);
  };

  const handleSendMove = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const price = parseFloat(counterPrice);
    if (isNaN(price) || price <= 0) {
      setErrorMsg("Please enter a valid positive offer price.");
      return;
    }

    const qty = parseInt(counterQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg("Please enter a valid order quantity (at least 1 unit).");
      return;
    }

    try {
      await submitMove({
        session_id,
        offered_price: price,
        quantity: qty,
        buyer_message: buyerMessage,
      }).unwrap();
      setCounterPrice("");
      setBuyerMessage("");
      refetch();
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err, "Failed to submit your proposal."));
    }
  };

  const handleAccept = async () => {
    setErrorMsg(null);
    try {
      await acceptDeal(session_id).unwrap();
      refetch();
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err, "Failed to accept the proposed price."));
    }
  };

  const handleDecline = async () => {
    setErrorMsg(null);
    try {
      await declineDeal(session_id).unwrap();
      refetch();
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err, "Failed to close the negotiation."));
    }
  };

  const handleA2AStep = async () => {
    setErrorMsg(null);
    try {
      await runA2aStep({ session_id }).unwrap();
      refetch();
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err, "Automated negotiation step could not be completed."));
    }
  };

  const handleA2ALoop = async () => {
    setErrorMsg(null);
    try {
      await runA2aLoop({ session_id, max_rounds: 5 }).unwrap();
      refetch();
    } catch (err: any) {
      setErrorMsg(formatErrorMessage(err, "Automated negotiation loop encountered an issue."));
    }
  };

  const statusVariantMap: Record<string, "success" | "warning" | "danger" | "default" | "info"> = {
    AGREED: "success",
    PENDING_APPROVAL: "warning",
    IN_PROGRESS: "info",
    FINAL_OFFER: "warning",
    REJECTED: "danger",
    EXPIRED: "default",
    INITIATED: "default",
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Session Header Card */}
      <div className="rounded-2xl border border-white/10 bg-neutral-850 p-6 shadow-2xl mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-primary-400 font-bold">Bargaining Round {session.current_round}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {session.product_name}
            </h1>
            <p className="text-xs text-neutral-400 mt-1">
              Order Quantity: <strong className="text-neutral-200">{session.quantity} units</strong> • Standard Price: ₹{session.base_price?.toLocaleString("en-IN") || "—"}
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <Badge variant={isPaid ? "success" : statusVariantMap[session.status] || "default"}>
              {isPaid ? "DEAL SEALED & PAID" : session.status.replace("_", " ")}
            </Badge>

            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              <ShieldCheck className="h-3 w-3" />
              <span>Verified Deal Record</span>
            </span>
          </div>
        </div>

        {/* Current State Summary Pill */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="rounded-xl bg-neutral-900/60 p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-neutral-500 block">Seller Counter Price</span>
            <span className="text-sm sm:text-base font-mono font-bold text-neutral-100">
              {session.latest_seller_price ? `₹${session.latest_seller_price.toLocaleString("en-IN")}` : "Awaiting Offer"}
            </span>
          </div>

          <div className="rounded-xl bg-neutral-900/60 p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-neutral-500 block">Your Proposed Price</span>
            <span className="text-sm sm:text-base font-mono font-bold text-neutral-100">
              {session.latest_buyer_price ? `₹${session.latest_buyer_price.toLocaleString("en-IN")}` : "No counter yet"}
            </span>
          </div>

          <div className="rounded-xl bg-neutral-900/60 p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-neutral-500 block">Agreed Total</span>
            <span className="text-sm sm:text-base font-mono font-bold text-primary-400">
              {session.final_agreed_price
                ? `₹${(session.final_agreed_price * session.quantity).toLocaleString("en-IN")}`
                : session.latest_seller_price
                ? `₹${(session.latest_seller_price * session.quantity).toLocaleString("en-IN")}`
                : "—"}
            </span>
          </div>

          <div className="rounded-xl bg-neutral-900/60 p-3 border border-white/5">
            <span className="text-[10px] uppercase font-bold text-neutral-500 block">Order Status</span>
            <span className="text-sm sm:text-base font-bold text-neutral-200">
              {isPaid ? "PAID & CONFIRMED" : session.status === "AGREED" ? "AGREED" : isTerminal ? "CLOSED" : "IN PROGRESS"}
            </span>
          </div>
        </div>
      </div>

      {/* 1. COMPLETED & PAID STATE: Minimal, Clean Payment Success UI */}
      {isPaid ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-neutral-850 p-6 mb-6 shadow-xl animate-fadeIn">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/10 pb-5 mb-5">
            <div className="flex items-center gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-glow">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">Payment Successful</h2>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                    Paid
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Your payment has been captured and your wholesale order is registered.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800 px-3.5 py-2 text-xs font-semibold text-neutral-300 hover:text-white hover:bg-neutral-750 transition-colors"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print Receipt</span>
              </button>
              <Link
                to="/sessions"
                className="inline-flex items-center gap-1.5 rounded-xl border border-primary-500/30 bg-primary-500/10 px-3.5 py-2 text-xs font-bold text-primary-400 hover:bg-primary-500/20 transition-all"
              >
                <span>View Order History</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Minimal 4-Column Summary Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-neutral-900/80 rounded-xl p-4 border border-white/5 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">Product</span>
              <strong className="text-neutral-200 block truncate mt-0.5">{session.product_name}</strong>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">Quantity</span>
              <strong className="text-neutral-200 block mt-0.5">{session.quantity} units</strong>
              <span className="text-neutral-500 text-[10px]">₹{session.final_agreed_price?.toLocaleString("en-IN")}/unit</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">Total Settled</span>
              <strong className="text-emerald-400 font-mono block mt-0.5 text-sm">
                ₹{((session.final_agreed_price || 0) * session.quantity).toLocaleString("en-IN")}
              </strong>
              <span className="text-neutral-500 text-[10px]">Settled via Razorpay</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-neutral-500 block">Order Reference</span>
              <strong className="text-neutral-300 font-mono block truncate mt-0.5">
                {session.session_id.slice(0, 12)}
              </strong>
              <span className="text-emerald-400/80 font-mono text-[10px]">Deal Sealed</span>
            </div>
          </div>
        </div>
      ) : session.status === "AGREED" && !isMerchant ? (
        /* 2. AGREED BUT PENDING PAYMENT: Settle & Pay CTA */
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 mb-6 text-center animate-fadeIn shadow-glow">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
          <h2 className="text-xl font-bold text-white">Price Agreement Reached!</h2>
          <p className="text-xs text-neutral-300 mt-1 max-w-md mx-auto">
            Unit price confirmed at <strong className="text-emerald-400 font-mono">₹{session.final_agreed_price?.toLocaleString("en-IN")}</strong> for {session.quantity} units. Total payable: ₹{((session.final_agreed_price || 0) * session.quantity).toLocaleString("en-IN")}.
          </p>

          <div className="mt-4 flex justify-center gap-3">
            <a
              href={`http://127.0.0.1:8001/api/v1/checkout/${session.session_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-primary-500 px-6 py-3 text-sm font-bold text-neutral-950 shadow-glow hover:bg-primary-400 transition-all active:scale-95"
            >
              <span>Complete Payment Settlement</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      ) : null}

      {/* Rejection State Banner */}
      {session.status === "REJECTED" && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 mb-6 text-center animate-fadeIn">
          <XCircle className="h-10 w-10 text-red-400 mx-auto mb-2" />
          <h2 className="text-lg font-bold text-white">Deal Not Finalized</h2>
          <p className="text-xs text-neutral-300 mt-1">
            This negotiation ended without an agreement. You can start a new request anytime from the catalog.
          </p>
        </div>
      )}

      {/* 4. Escalated to Merchant Desk Banner */}
      {session.status === "PENDING_APPROVAL" && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 mb-6 text-center animate-fadeIn shadow-lg">
          <Clock className="h-10 w-10 text-amber-400 mx-auto mb-2 animate-pulse" />
          <h2 className="text-lg font-bold text-white">Escalated for Merchant Review</h2>
          <p className="text-xs text-neutral-300 mt-1 max-w-lg mx-auto">
            Your counter-proposal requires executive approval from the merchant desk.
            Further proposals are temporarily paused while margin thresholds are reviewed.
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-300 border border-amber-500/30">
            <span>● Pending Merchant Decision</span>
          </div>
        </div>
      )}

      {/* 5. Final Take-It-Or-Leave-It Offer Banner */}
      {session.status === "FINAL_OFFER" && (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-6 mb-6 text-center animate-fadeIn shadow-lg">
          <AlertTriangle className="h-10 w-10 text-sky-400 mx-auto mb-2" />
          <h2 className="text-lg font-bold text-white">Final Round — Take It or Leave It</h2>
          <p className="text-xs text-neutral-300 mt-1 max-w-lg mx-auto">
            The negotiation has reached its final round limit. The seller has submitted their best price of{" "}
            <strong className="text-sky-300 font-mono">
              ₹{session.latest_seller_price ? session.latest_seller_price.toLocaleString("en-IN") : "—"}
            </strong>{" "}
            per unit. You may accept to lock in this deal, or walk away.
          </p>
        </div>
      )}

      {/* Live Autonomous Deliberation Indicator */}
      {(isA2aLoopLoading || isA2aStepLoading) && (
        <div className="rounded-2xl border border-primary-500/40 bg-primary-500/10 p-5 mb-6 flex items-center justify-center gap-3 animate-pulse shadow-glow">
          <Loader2 className="h-5 w-5 text-primary-400 animate-spin shrink-0" />
          <div className="text-left">
            <h4 className="text-xs font-bold text-white">Autonomous AI Negotiation in Progress...</h4>
            <p className="text-[11px] text-neutral-300">
              The buyer agent is deliberating and bargaining dual-metric wholesale terms with the seller engine.
            </p>
          </div>
        </div>
      )}

      {/* Offer Timeline History */}
      <div className="rounded-2xl border border-white/10 bg-neutral-850 p-6 shadow-2xl mb-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-4">
          Price Discussion History
        </h3>

        <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-2">
          {(!session.offer_history || session.offer_history.length === 0) ? (
            <div className="text-center py-8 text-xs text-neutral-500">
              No price offers exchanged yet.
            </div>
          ) : (
            session.offer_history.map((ev, idx) => {
              const isBuyer = ev.sender === "BUYER";
              return (
                <div
                  key={idx}
                  className={`flex gap-3 max-w-xl ${isBuyer ? "ml-auto flex-row-reverse" : "mr-auto"}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                      isBuyer
                        ? "bg-neutral-800 border-white/10 text-neutral-200"
                        : "bg-primary-500/20 border-primary-500/40 text-primary-400"
                    }`}
                  >
                    {isBuyer ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>

                  <div
                    className={`rounded-2xl p-4 text-xs ${
                      isBuyer
                        ? "bg-neutral-800 border border-white/10 text-neutral-200"
                        : "bg-neutral-900 border border-primary-500/20 text-neutral-100"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className="font-semibold text-neutral-400">
                        {isBuyer ? "Buyer Proposal" : "Automated Seller Counter"}
                      </span>
                      <span className="font-mono text-[10px] text-neutral-500">
                        Round {ev.round_number}
                      </span>
                    </div>

                    <div className="font-mono text-base font-bold text-white mb-1">
                      ₹{ev.proposed_price.toLocaleString("en-IN")}
                      <span className="text-xs text-neutral-400 font-normal"> / unit</span>
                    </div>

                    {ev.public_justification && (
                      <p className="text-neutral-300 leading-relaxed mt-1 text-[11px] bg-neutral-950/40 p-2.5 rounded-lg border border-white/5">
                        "{ev.public_justification}"
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Buyer Action Desk (Hidden for Merchants and Closed/Paid Deals) */}
      {!isMerchant && !isTerminal && (
        <div className="rounded-2xl border border-white/10 bg-neutral-850 p-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
            <h3 className="text-sm font-bold text-neutral-100">Make Your Offer</h3>

            {/* Smart Auto-Bargaining Controls */}
            {!isFinalOffer ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleA2AStep}
                  isLoading={isA2aStepLoading}
                  disabled={isA2aStepLoading || isA2aLoopLoading || isMoveLoading}
                  className="text-xs gap-1.5"
                >
                  <Play className="h-3 w-3 text-primary-400" />
                  <span>Single Round</span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleA2ALoop}
                  isLoading={isA2aLoopLoading}
                  disabled={isA2aStepLoading || isA2aLoopLoading || isMoveLoading}
                  className="text-xs gap-1.5"
                >
                  <Sparkles className="h-3 w-3 fill-current" />
                  <span>Auto-Bargain</span>
                </Button>
              </div>
            ) : (
              <span className="rounded-lg bg-sky-500/10 px-2.5 py-1 text-xs font-mono text-sky-400 border border-sky-500/20">
                Final Offer Active
              </span>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 mb-4">
              {errorMsg}
            </div>
          )}

          {/* Proposal Form (Only available before final round) */}
          {!isFinalOffer ? (
            <form onSubmit={handleSendMove} className="flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Proposed Price Per Unit (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={counterPrice}
                    onChange={(e) => setCounterPrice(e.target.value)}
                    placeholder={`e.g. ${session.latest_seller_price ? session.latest_seller_price - 50 : 500}`}
                    className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2.5 font-mono text-sm text-neutral-100 outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Order Quantity (Units)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={counterQuantity}
                    onChange={(e) => setCounterQuantity(e.target.value)}
                    placeholder="e.g. 50"
                    className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2.5 font-mono text-sm text-neutral-100 outline-none focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">
                    Optional Note / Context
                  </label>
                  <input
                    type="text"
                    value={buyerMessage}
                    onChange={(e) => setBuyerMessage(e.target.value)}
                    placeholder="e.g. Bulk commitment, recurring orders"
                    className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3.5 py-2.5 text-xs text-neutral-100 outline-none focus:border-primary-500"
                  />
                </div>
              </div>

              {/* Real-time Projected Outlay Preview */}
              {parseFloat(counterPrice) > 0 && parseInt(counterQuantity, 10) > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-neutral-900/60 px-4 py-2 border border-white/5 text-xs animate-fadeIn">
                  <span className="text-neutral-400">Projected Total Outlay:</span>
                  <span className="font-mono font-bold text-primary-400 text-sm">
                    ₹{(parseFloat(counterPrice) * parseInt(counterQuantity, 10)).toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  type="submit"
                  isLoading={isMoveLoading}
                  disabled={isA2aStepLoading || isA2aLoopLoading}
                  className="py-2.5"
                >
                  <span>Submit Price Proposal</span>
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>

                <div className="flex items-center gap-2">
                  {session.latest_seller_price && (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleAccept}
                      isLoading={isAcceptLoading}
                      disabled={isA2aStepLoading || isA2aLoopLoading || isMoveLoading}
                      className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-glow"
                    >
                      Accept ₹{session.latest_seller_price.toLocaleString("en-IN")} Price
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    onClick={handleDecline}
                    isLoading={isDeclineLoading}
                    disabled={isA2aStepLoading || isA2aLoopLoading || isMoveLoading}
                  >
                    Walk Away
                  </Button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
              <p className="text-xs text-neutral-400">
                You cannot submit another counter in the final round. Choose to accept the seller's final offer or walk away.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                {session.latest_seller_price && (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleAccept}
                    isLoading={isAcceptLoading}
                    className="bg-emerald-500 hover:bg-emerald-400 text-neutral-950 shadow-glow"
                  >
                    Accept Final ₹{session.latest_seller_price.toLocaleString("en-IN")} Price
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  onClick={handleDecline}
                  isLoading={isDeclineLoading}
                >
                  Walk Away
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Merchant Notice when viewing session */}
      {isMerchant && (
        <div className="rounded-xl border border-white/5 bg-neutral-900/60 p-4 text-center text-xs text-neutral-400">
          Viewing this deal in Merchant Supervisory Mode. Only buyers can submit counter proposals and complete payments.
        </div>
      )}
    </div>
  );
};
