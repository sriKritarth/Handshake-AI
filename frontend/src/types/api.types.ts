export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "buyer" | "merchant" | "admin";
}

export interface CatalogSku {
  id?: string;
  sku_code: string;
  name: string;
  category: string;
  description: string;
  base_price: number;
  Image_url?: string | null;
}

export interface OfferEvent {
  round_number: number;
  sender: "BUYER" | "SELLER_AI" | "SELLER_GUARDRAIL" | "MERCHANT";
  proposed_price: number;
  public_justification?: string | null;
  quantity?: number;
  created_at?: string;
}

export interface NegotiationSession {
  session_id: string;
  status: "INITIATED" | "IN_PROGRESS" | "PENDING_APPROVAL" | "FINAL_OFFER" | "AGREED" | "REJECTED" | "EXPIRED" | "PAID";
  payment_status?: string | null;
  current_round: number;
  quantity: number;
  sku_code: string;
  product_name: string;
  base_price?: number;
  latest_buyer_price: number | null;
  latest_seller_price: number | null;
  final_agreed_price: number | null;
  amount: number | null;
  amount_paise: number | null;
  currency: string | null;
  checkout_url: string | null;
  expires_at?: string | null;
  created_at?: string;
  offer_history?: OfferEvent[];
}

export interface CheckoutDetails {
  session_id: string;
  sku_code: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  amount_paise: number;
  currency: string;
  payment_url: string;
  payment_status: string;
  session_status: string;
}

export interface MerchantApprovalRequest {
  id: string;
  session_id: string;
  requested_price: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  created_at: string;
  merchant_notes?: string | null;
}
