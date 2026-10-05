import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useListSessionsQuery } from "@/features/api/apiSlice";
import { isSessionPaid } from "@/utils/paidStorage";
import { Badge } from "@/components/common/Badge";
import { ArrowRight, Bot, Clock, Sparkles, CheckCircle2 } from "lucide-react";

export const SessionsListPage: React.FC = () => {
  const [filter, setFilter] = useState<string>("all");

  // Pass "all" when filter is "all" or "PAID" to ensure Express Gateway returns completed/agreed deals
  const queryStatus = filter === "all" || filter === "PAID" ? "all" : filter;
  const { data: sessionResponse, isLoading, error } = useListSessionsQuery(queryStatus);
  const rawSessions = sessionResponse?.data || [];

  // Filter for PAID tab if selected
  const sessions =
    filter === "PAID"
      ? rawSessions.filter(
          (s) =>
            isSessionPaid(s.session_id) ||
            s.status === "PAID" ||
            (s as any).payment_status === "PAID"
        )
      : rawSessions;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Wholesale Orders & Deals History
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Track active negotiations, confirmed agreements, and paid orders.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {["all", "PAID", "AGREED", "IN_PROGRESS", "PENDING_APPROVAL", "REJECTED"].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${
                filter === status
                  ? "bg-primary-500 text-neutral-950 font-bold shadow-glow"
                  : "border border-white/10 bg-neutral-850 text-neutral-400 hover:text-white"
              }`}
            >
              {status.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-neutral-400">
          Loading order history...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center text-red-400">
          <p className="font-semibold text-sm">Failed to load negotiation sessions.</p>
          <p className="text-xs text-neutral-400 mt-1">Please ensure you are signed in.</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-850 p-16 text-center text-neutral-400">
          <Bot className="h-10 w-10 text-neutral-600 mx-auto mb-3" />
          <p className="font-semibold text-neutral-200">
            {filter === "PAID"
              ? "No paid orders found yet."
              : "No negotiation sessions found."}
          </p>
          <span className="text-xs text-neutral-500 block mt-1">
            Browse the catalog to launch a live price negotiation or place an order.
          </span>
          <Link
            to="/"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary-500 px-4 py-2 text-xs font-bold text-neutral-950 shadow-glow hover:bg-primary-400 transition-all"
          >
            <Sparkles className="h-3.5 w-3.5 fill-current" />
            <span>Browse Catalog</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sessions.map((sess) => {
            const isPaid =
              isSessionPaid(sess.session_id) ||
              sess.status === "PAID" ||
              (sess as any).payment_status === "PAID";

            return (
              <Link
                key={sess.session_id}
                to={`/session/${sess.session_id}`}
                className="group rounded-2xl border border-white/10 bg-neutral-850/80 p-5 transition-all hover:-translate-y-0.5 hover:border-primary-500/40 hover:shadow-card block"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-primary-400">
                    B2B Negotiation
                  </span>
                  <Badge
                    variant={
                      isPaid
                        ? "success"
                        : sess.status === "AGREED"
                        ? "warning"
                        : sess.status === "REJECTED"
                        ? "danger"
                        : "info"
                    }
                  >
                    {isPaid ? "PAID" : sess.status.replace("_", " ")}
                  </Badge>
                </div>

                <h3 className="text-base font-bold text-white group-hover:text-primary-400 transition-colors">
                  {sess.product_name || "B2B Wholesale Order"}
                </h3>

                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div>
                      <span className="text-neutral-500 block text-[10px]">Round</span>
                      <strong className="text-neutral-200">{sess.current_round}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-500 block text-[10px]">
                        {isPaid ? "Unit Price" : "Latest Offer"}
                      </span>
                      <strong className={isPaid ? "text-emerald-400 font-bold" : "text-neutral-200"}>
                        ₹{(sess.final_agreed_price || sess.latest_seller_price || sess.base_price || 0).toLocaleString("en-IN")}
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 text-xs font-semibold text-neutral-400 group-hover:text-white transition-colors">
                    <span>{isPaid ? "View Receipt" : "Enter Room"}</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};
