import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import {
  CatalogSku,
  NegotiationSession,
  CheckoutDetails,
  User,
  MerchantApprovalRequest,
} from "@/types/api.types";

const getBaseUrl = (): string => {
  const envUrl = import.meta.env.VITE_API_URL || "http://localhost:8000";
  const cleanUrl = envUrl.replace(/\/+$/, "");
  return cleanUrl.endsWith("/api/v1") ? cleanUrl : `${cleanUrl}/api/v1`;
};

export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: getBaseUrl(),
    prepareHeaders: (headers) => {
      const token = localStorage.getItem("auth_token");
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: ["Catalog", "Session", "User", "MerchantPending", "Audit"],
  endpoints: (builder) => ({
    // ---------------- AUTH ----------------
    login: builder.mutation<
      { success: boolean; token: string; user: User; message: string },
      { email_id: string; password: string }
    >({
      query: (credentials) => ({
        url: "/auth/login",
        method: "POST",
        body: credentials,
      }),
      invalidatesTags: ["User"],
    }),

    signup: builder.mutation<
      { success: boolean; token: string; user: User; message: string },
      {
        first_name: string;
        last_name: string;
        email_id: string;
        password: string;
        confirm_password: string;
        role?: "buyer" | "merchant";
      }
    >({
      query: (userData) => ({
        url: "/auth/sign_up",
        method: "POST",
        body: userData,
      }),
      invalidatesTags: ["User"],
    }),

    getMe: builder.query<{ success: boolean; data: User }, void>({
      query: () => "/auth/me",
      providesTags: ["User"],
    }),

    // ---------------- CATALOG ----------------
    getCatalog: builder.query<{ success: boolean; data: CatalogSku[]; count: number }, void>({
      query: () => "/catalog",
      providesTags: ["Catalog"],
    }),

    getCatalogBySku: builder.query<{ success: boolean; data: CatalogSku }, string>({
      query: (sku_code) => `/catalog/${sku_code}`,
      providesTags: (_res, _err, arg) => [{ type: "Catalog", id: arg }],
    }),

    // ---------------- SESSIONS & NEGOTIATION ----------------
    listSessions: builder.query<
      { success: boolean; data: NegotiationSession[]; count: number },
      string | void
    >({
      query: (status) => (status ? `/sessions?status=${status}` : "/sessions"),
      providesTags: ["Session"],
    }),

    getSession: builder.query<{ success: boolean; data: NegotiationSession }, string>({
      query: (session_id) => `/sessions/${session_id}`,
      providesTags: (_res, _err, arg) => [{ type: "Session", id: arg }],
    }),

    createSession: builder.mutation<
      { success: boolean; session_id: string; data: any; message: string },
      { sku_code: string; quantity: number }
    >({
      query: (body) => ({
        url: "/sessions",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Session"],
    }),

    submitBuyerMove: builder.mutation<
      { success: boolean; data: any; message: string },
      {
        session_id: string;
        offered_price: number;
        quantity: number;
        buyer_message?: string;
        accept_last_offer?: boolean;
      }
    >({
      query: ({ session_id, ...body }) => ({
        url: `/sessions/${session_id}/moves`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Session", id: arg.session_id }],
    }),

    acceptOffer: builder.mutation<
      { success: boolean; data: any; message: string },
      string
    >({
      query: (session_id) => ({
        url: `/sessions/${session_id}/accept`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [{ type: "Session", id }],
    }),

    declineOffer: builder.mutation<
      { success: boolean; data: any; message: string },
      string
    >({
      query: (session_id) => ({
        url: `/sessions/${session_id}/decline`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, id) => [{ type: "Session", id }],
    }),

    // ---------------- AUTONOMOUS AGENT-TO-AGENT (A2A) ----------------
    a2aStep: builder.mutation<
      { success: boolean; data: any; message: string },
      {
        session_id: string;
        target_price?: number;
        walk_away_price?: number;
        max_budget?: number;
      }
    >({
      query: ({ session_id, ...body }) => ({
        url: `/sessions/${session_id}/a2a/step`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Session", id: arg.session_id }],
    }),

    a2aAutoRun: builder.mutation<
      {
        success: boolean;
        final_status: string;
        total_rounds: number;
        transcript: any[];
        final_agreed_price?: number;
        amount?: number;
        checkout_url?: string;
      },
      {
        session_id: string;
        target_price?: number;
        walk_away_price?: number;
        max_budget?: number;
        max_rounds?: number;
      }
    >({
      query: ({ session_id, ...body }) => ({
        url: `/sessions/${session_id}/a2a/auto-run`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Session", id: arg.session_id }],
    }),

    // ---------------- MERCHANT DESK ----------------
    getPendingApprovals: builder.query<
      { success: boolean; data: MerchantApprovalRequest[] },
      void
    >({
      query: () => "/merchant/session/get",
      providesTags: ["MerchantPending"],
    }),

    submitMerchantDecision: builder.mutation<
      { success: boolean; data: any; message: string },
      {
        session_id: string;
        action: "approve" | "reject" | "counter";
        counter_price?: number;
        merchant_notes?: string;
      }
    >({
      query: ({ session_id, ...body }) => ({
        url: `/sessions/${session_id}/merchant_decision`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "Session", id: arg.session_id },
        "MerchantPending",
      ],
    }),

    // ---------------- CHECKOUT & AUDIT ----------------
    checkoutCart: builder.mutation<
      {
        success: boolean;
        session_id: string;
        razorpay_order_id: string;
        amount: number;
        amount_paise: number;
        currency: string;
        payment_url: string;
        message: string;
      },
      {
        items: Array<{
          sku_code: string;
          quantity: number;
          unit_price?: number;
        }>;
      }
    >({
      query: (body) => ({
        url: "/checkout/cart",
        method: "POST",
        body,
      }),
      invalidatesTags: ["Session"],
    }),

    getCheckoutDetails: builder.query<{ success: boolean; data: CheckoutDetails }, string>({
      query: (session_id) => `/checkout/${session_id}`,
    }),

    getAuditTrail: builder.query<{ success: boolean; data: any }, string>({
      query: (session_id) => `/sessions/${session_id}/audit`,
      providesTags: (_res, _err, id) => [{ type: "Audit", id }],
    }),

    verifyAuditChain: builder.query<{ success: boolean; data: any }, string>({
      query: (session_id) => `/sessions/${session_id}/verify`,
    }),
  }),
});

export const {
  useLoginMutation,
  useSignupMutation,
  useGetMeQuery,
  useGetCatalogQuery,
  useGetCatalogBySkuQuery,
  useListSessionsQuery,
  useGetSessionQuery,
  useCreateSessionMutation,
  useSubmitBuyerMoveMutation,
  useAcceptOfferMutation,
  useDeclineOfferMutation,
  useA2aStepMutation,
  useA2aAutoRunMutation,
  useGetPendingApprovalsQuery,
  useSubmitMerchantDecisionMutation,
  useCheckoutCartMutation,
  useGetCheckoutDetailsQuery,
  useGetAuditTrailQuery,
  useVerifyAuditChainQuery,
} = apiSlice;
