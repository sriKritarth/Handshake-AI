import { apiClient, ApiError, normalizeClientMessage } from './client';

/**
 * 10. Master Copywriting & Anti-Jargon Sanitizer
 * Replaces forbidden internal and technical jargon with clean, client-facing terms.
 */
export function sanitizeClientMessage(msg: string | null | undefined): string {
  if (!msg) return '';
  let clean = msg;
  clean = clean.replace(/live\s+harvard\s+give-get\s+engine/gi, 'Instant wholesale volume discounts');
  clean = clean.replace(/harvard\s+give-get/gi, 'wholesale volume discount');
  clean = clean.replace(/30-min(?:ute)?\s+sla\s+escalation/gi, '30-minute supplier review window');
  clean = clean.replace(/\b30-min\s+sla\b/gi, '30-minute supplier review window');
  clean = clean.replace(/\bsla\b/gi, 'supplier review window');
  clean = clean.replace(/prices?\s+in\s+inr\s+minor\s+units/gi, 'All prices in Indian Rupees (₹), taxes included');
  clean = clean.replace(/minor\s+units/gi, 'Rupees');
  clean = clean.replace(/seller\s+guardrail\s+clamped\s+price/gi, 'Best available wholesale rate');
  clean = clean.replace(/guardrail\s+clamped\s+price/gi, 'Best available wholesale rate');
  clean = clean.replace(/guardrail\s+clamped/gi, 'wholesale rate adjusted');
  clean = clean.replace(/a2a\s+autonomous\s+loop\s+running/gi, 'Auto-Negotiating best price...');
  clean = clean.replace(/a2a\s+(?:auto-run|loop|step)/gi, 'pricing assistant');
  clean = clean.replace(/session\s+is\s+(?:already\s+in\s+)?terminal\s+state\s*['"]?\w*['"]?/gi, 'This negotiation has concluded.');
  clean = clean.replace(/terminal\s+state/gi, 'concluded');
  return clean.trim();
}

export interface OfferEvent {
  round_number: number;
  sender: 'BUYER' | 'SELLER' | 'MERCHANT' | string;
  proposed_price: number;
  guardrail_clamped_price?: number;
  quantity?: number;
  public_justification?: string;
  created_at?: string;
}

export interface SessionDetail {
  session_id: string;
  status: 'IN_PROGRESS' | 'AGREED' | 'REJECTED' | 'EXPIRED' | 'PAID' | 'PENDING_APPROVAL';
  current_round: number;
  base_price: number;
  quantity: number;
  sku_code: string;
  product_name: string;
  latest_seller_price: number | null;
  final_agreed_price: number | null;
  offer_history: OfferEvent[];
  expires_at?: string;
}

export interface SessionSummary {
  session_id: string;
  status: string;
  product_name: string;
  sku_code: string;
  quantity: number;
  base_price: number;
  agreed_price: number | null;
  latest_counter: number | null;
  created_date: string;
}

export interface BuyerMoveResponse {
  status: string;
  seller_proposed_price?: number;
  counter_quantity?: number;
  draft_justification?: string;
  final_agreed_price?: number;
  message?: string;
}

export interface A2AStepResponse {
  session_id: string;
  buyer_decision?: {
    action: 'OFFER' | 'ACCEPT' | 'WALK_AWAY';
    offer_price?: number;
    quantity?: number;
    message?: string;
  };
  seller_response?: BuyerMoveResponse;
  status: string;
}

export interface A2AAutoRunResponse {
  transcript: Array<{
    buyer_decision?: { offer_price?: number; message?: string };
    seller_response?: { seller_proposed_price?: number; draft_justification?: string; status?: string };
  }>;
  final_status: string;
  result?: {
    final_agreed_price?: number;
    seller_proposed_price?: number;
  };
}

/**
 * Task 1: POST /api/v1/sessions
 * ALGORITHM: InitializeNegotiationSession(skuCode, requestedQty)
 */
export async function initializeNegotiationSession(
  skuCode: string,
  requestedQty: number
): Promise<{ success: boolean; session_id: string; data: any }> {
  // 1. Pre-flight validation
  const cleanSku = (skuCode || '').trim();
  if (!cleanSku) {
    throw new Error('Please select an item to begin negotiation.');
  }

  // Sanitize quantity between 1 and 100
  const sanitizedQty = Math.max(1, Math.min(100, Math.floor(Number(requestedQty) || 1)));

  try {
    const res = await apiClient.post<any>('/sessions', {
      sku_code: cleanSku,
      quantity: sanitizedQty,
    });

    const sessionId = res.session_id || res.data?.session_id || res.data?.id;
    if (!sessionId) {
      throw new Error('Session identifier missing in server response.');
    }

    return {
      success: true,
      session_id: sessionId,
      data: res.data || res,
    };
  } catch (err: any) {
    if (err?.status === 401) {
      throw new Error('Please sign in to make a price offer.');
    }
    if (err?.status === 404) {
      throw new Error('This product is currently out of stock for negotiation.');
    }
    if (err?.status === 429) {
      throw new Error('You are starting offers too quickly. Please wait a few seconds.');
    }
    if (err?.status === 422) {
      throw new Error('Please choose a quantity between 1 and 100.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Could not start negotiation. Please check your connection and try again.'
    );
  }
}

/**
 * Task 2: GET /api/v1/sessions
 * ALGORITHM: FetchBuyerNegotiationHistory(pageNumber, selectedStatus)
 */
export async function fetchBuyerNegotiationHistory(
  pageNumber = 1,
  selectedStatus = 'ALL'
): Promise<{
  sessions: SessionSummary[];
  total: number;
  hasMore: boolean;
  page: number;
}> {
  const safePage = Math.max(1, Math.floor(Number(pageNumber) || 1));
  const safeLimit = 15;
  const safeStatus = selectedStatus && selectedStatus !== 'ALL' ? selectedStatus.toUpperCase() : 'ALL';

  const endpoint = `/sessions?page=${safePage}&limit=${safeLimit}&status=${safeStatus}`;

  const res = await apiClient.get<any>(endpoint);
  const rawList: any[] = Array.isArray(res?.data) ? res.data : [];

  const sessions: SessionSummary[] = rawList.map((item) => {
    const skuInfo = item.catalog_skus || {};
    const events: any[] = Array.isArray(item.offer_events) ? item.offer_events : [];
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;

    return {
      session_id: item.id || item.session_id,
      status: String(item.status || 'IN_PROGRESS').toUpperCase(),
      product_name: skuInfo.name || item.product_name || 'Wholesale Inventory Item',
      sku_code: skuInfo.sku_code || item.sku_code || '',
      quantity: Number(item.quantity || latestEvent?.quantity || 1),
      base_price: Number(skuInfo.base_price || item.base_price || 0),
      agreed_price: item.final_agreed_price ? Number(item.final_agreed_price) : null,
      latest_counter: latestEvent?.proposed_price ? Number(latestEvent.proposed_price) : null,
      created_date: item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN') : 'Recently',
    };
  });

  const total = Number(res?.total || sessions.length);
  const hasMore = Boolean(res?.has_more ?? safePage * safeLimit < total);

  return {
    sessions,
    total,
    hasMore,
    page: safePage,
  };
}

/**
 * Task 3: GET /api/v1/sessions/:session_id
 * ALGORITHM: HydrateSessionDetails(sessionId)
 */
export async function hydrateSessionDetails(sessionId: string): Promise<SessionDetail> {
  if (!sessionId) {
    throw new Error('Session identifier required.');
  }

  try {
    const res = await apiClient.get<any>(`/sessions/${encodeURIComponent(sessionId)}`);
    const raw = res.data || res;

    const offerHistory: OfferEvent[] = Array.isArray(raw.offer_history)
      ? raw.offer_history.map((ev: any) => ({
          round_number: Number(ev.round_number || 1),
          sender: String(ev.sender || 'SELLER').toUpperCase(),
          proposed_price: Number(ev.proposed_price || ev.guardrail_clamped_price || 0),
          guardrail_clamped_price: ev.guardrail_clamped_price ? Number(ev.guardrail_clamped_price) : undefined,
          quantity: Number(ev.quantity || raw.quantity || 1),
          public_justification: sanitizeClientMessage(ev.public_justification),
          created_at: ev.created_at,
        }))
      : [];

    return {
      session_id: raw.id || raw.session_id || sessionId,
      status: String(raw.status || 'IN_PROGRESS').toUpperCase() as any,
      current_round: Number(raw.current_round || 1),
      base_price: Number(raw.base_price || 0),
      quantity: Number(raw.quantity || 1),
      sku_code: raw.sku_code || '',
      product_name: raw.product_name || 'Wholesale Product',
      latest_seller_price: raw.latest_seller_price ? Number(raw.latest_seller_price) : null,
      final_agreed_price: raw.final_agreed_price ? Number(raw.final_agreed_price) : null,
      offer_history: offerHistory,
      expires_at: raw.expires_at,
    };
  } catch (err: any) {
    if (err?.status === 410) {
      throw new Error('This negotiation has timed out due to inactivity. Please start a new offer.');
    }
    if (err?.status === 403) {
      throw new Error('You do not have permission to view this offer.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Unable to load negotiation details. Please check your connection.'
    );
  }
}

/**
 * Task 5: POST /api/v1/sessions/:session_id/moves
 * ALGORITHM: SubmitBuyerOffer(sessionId, targetPrice, quantity, message)
 */
export async function submitBuyerOffer(
  sessionId: string,
  targetPrice: number | string,
  quantity: number | string,
  message = ''
): Promise<BuyerMoveResponse> {
  const priceNum = Math.round(Number(targetPrice));
  const qtyNum = Math.floor(Number(quantity));

  if (isNaN(priceNum) || priceNum <= 0) {
    throw new Error('Please enter a valid price greater than ₹0.');
  }

  if (isNaN(qtyNum) || qtyNum < 1 || qtyNum > 100) {
    throw new Error('Please select between 1 and 100 items.');
  }

  try {
    const res = await apiClient.post<any>(`/sessions/${encodeURIComponent(sessionId)}/moves`, {
      offered_price: priceNum,
      quantity: qtyNum,
      buyer_message: message ? message.trim() : undefined,
    });

    const data = res.data || res;
    return {
      status: String(data.status || 'IN_PROGRESS').toUpperCase(),
      seller_proposed_price: data.seller_proposed_price ? Number(data.seller_proposed_price) : undefined,
      counter_quantity: data.counter_quantity ? Number(data.counter_quantity) : qtyNum,
      draft_justification: sanitizeClientMessage(data.draft_justification || data.message),
      final_agreed_price: data.final_agreed_price ? Number(data.final_agreed_price) : undefined,
      message: sanitizeClientMessage(data.message),
    };
  } catch (err: any) {
    if (err?.status === 410) {
      throw new Error('This negotiation has timed out due to inactivity.');
    }
    if (err?.status === 422) {
      throw new Error('Please verify your price and quantity values.');
    }
    if (err?.status === 429) {
      throw new Error('You are sending offers too quickly. Please pause for a moment.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Could not send your offer. Please check your connection and try again.'
    );
  }
}

/**
 * Task 6: POST /api/v1/sessions/:session_id/accept
 * ALGORITHM: AcceptNegotiationDeal(sessionId)
 */
export async function acceptNegotiationDeal(
  sessionId: string
): Promise<{ success: boolean; finalPrice?: number }> {
  try {
    const res = await apiClient.post<any>(`/sessions/${encodeURIComponent(sessionId)}/accept`, {});
    const data = res.data || res;
    return {
      success: true,
      finalPrice: data.final_agreed_price ? Number(data.final_agreed_price) : undefined,
    };
  } catch (err: any) {
    if (err?.status === 410) {
      throw new Error('This offer has expired. Please propose a new price.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Unable to confirm this deal. Please try again.'
    );
  }
}

/**
 * Task 7: POST /api/v1/sessions/:session_id/decline
 * ALGORITHM: DeclineNegotiationOffer(sessionId)
 */
export async function declineNegotiationOffer(sessionId: string): Promise<boolean> {
  try {
    await apiClient.post(`/sessions/${encodeURIComponent(sessionId)}/decline`, {});
    return true;
  } catch {
    // Graceful client recovery: Even if network drops, respect user intent to walk away
    return true;
  }
}

/**
 * Task 8: POST /api/v1/sessions/:session_id/a2a/step
 * ALGORITHM: RequestAssistantBestOffer(sessionId, targetPrice)
 */
export async function requestAssistantBestOffer(
  sessionId: string,
  targetPrice?: number
): Promise<A2AStepResponse> {
  try {
    const payload = targetPrice && targetPrice > 0 ? { target_price: Math.round(targetPrice) } : {};
    const res = await apiClient.post<any>(`/sessions/${encodeURIComponent(sessionId)}/a2a/step`, payload);
    const data = res.data || res;

    return {
      session_id: data.session_id || sessionId,
      status: String(data.status || 'IN_PROGRESS').toUpperCase(),
      buyer_decision: data.buyer_decision
        ? {
            action: data.buyer_decision.action,
            offer_price: data.buyer_decision.offer_price ? Number(data.buyer_decision.offer_price) : undefined,
            quantity: data.buyer_decision.quantity ? Number(data.buyer_decision.quantity) : undefined,
            message: sanitizeClientMessage(data.buyer_decision.message),
          }
        : undefined,
      seller_response: data.seller_response
        ? {
            status: String(data.seller_response.status || '').toUpperCase(),
            seller_proposed_price: data.seller_response.seller_proposed_price
              ? Number(data.seller_response.seller_proposed_price)
              : undefined,
            draft_justification: sanitizeClientMessage(
              data.seller_response.draft_justification || data.seller_response.message
            ),
            final_agreed_price: data.seller_response.final_agreed_price
              ? Number(data.seller_response.final_agreed_price)
              : undefined,
          }
        : undefined,
    };
  } catch (err: any) {
    if (err?.status === 400) {
      if (err.message?.includes('pending') || err.message?.includes('approval')) {
        throw new Error('This deal is currently under manager review. Please wait.');
      }
      throw new Error('This negotiation has concluded.');
    }
    if (err?.status === 429) {
      throw new Error('Pricing assistant is busy. Please enter your price manually.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Unable to suggest a price right now. Please enter an amount manually.'
    );
  }
}

/**
 * Task 9: POST /api/v1/sessions/:session_id/a2a/auto-run
 * ALGORITHM: ExecuteAutonomousNegotiation(sessionId, targetPrice)
 */
export async function executeAutonomousNegotiation(
  sessionId: string,
  targetPrice?: number
): Promise<A2AAutoRunResponse> {
  try {
    const payload = targetPrice && targetPrice > 0 ? { target_price: Math.round(targetPrice) } : {};
    const res = await apiClient.post<any>(`/sessions/${encodeURIComponent(sessionId)}/a2a/auto-run`, payload);
    const data = res.data || res;

    const transcript = Array.isArray(data.transcript)
      ? data.transcript.map((item: any) => ({
          buyer_decision: item.buyer_decision
            ? {
                offer_price: item.buyer_decision.offer_price
                  ? Number(item.buyer_decision.offer_price)
                  : undefined,
                message: sanitizeClientMessage(item.buyer_decision.message),
              }
            : undefined,
          seller_response: item.seller_response
            ? {
                seller_proposed_price: item.seller_response.seller_proposed_price
                  ? Number(item.seller_response.seller_proposed_price)
                  : undefined,
                draft_justification: sanitizeClientMessage(
                  item.seller_response.draft_justification || item.seller_response.message
                ),
                status: item.seller_response.status,
              }
            : undefined,
        }))
      : [];

    return {
      transcript,
      final_status: String(data.final_status || 'IN_PROGRESS').toUpperCase(),
      result: data.result
        ? {
            final_agreed_price: data.result.final_agreed_price
              ? Number(data.result.final_agreed_price)
              : undefined,
            seller_proposed_price: data.result.seller_proposed_price
              ? Number(data.result.seller_proposed_price)
              : undefined,
          }
        : undefined,
    };
  } catch (err: any) {
    if (err?.status === 429) {
      throw new Error('Automated negotiation limit reached. Please make offers manually.');
    }
    throw new Error(
      sanitizeClientMessage(err.message) ||
        'Could not complete auto-negotiation. Please enter an offer manually.'
    );
  }
}
