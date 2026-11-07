import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initializeNegotiationSession,
  fetchBuyerNegotiationHistory,
  hydrateSessionDetails,
  submitBuyerOffer,
  acceptNegotiationDeal,
  declineNegotiationOffer,
  requestAssistantBestOffer,
  executeAutonomousNegotiation,
  sanitizeClientMessage,
} from '../api/negotiation';
import { apiClient } from '../api/client';

describe('Negotiation Sessions: Frontend Architecture & Edge-Case Algorithms', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Task 10: Master Copywriting & Anti-Jargon Dictionary
   */
  describe('Task 10: Anti-Jargon Dictionary Sanitizer', () => {
    it('replaces all prohibited internal and technical terms with client-facing terms', () => {
      // 1. Harvard Give-Get
      expect(sanitizeClientMessage('Live Harvard Give-Get engine active')).toBe(
        'Instant wholesale volume discounts active'
      );

      // 2. SLA
      expect(sanitizeClientMessage('Escalated with 30-min SLA escalation')).toBe(
        'Escalated with 30-minute supplier review window'
      );

      // 3. Minor units
      expect(sanitizeClientMessage('Prices in INR minor units')).toBe(
        'All prices in Indian Rupees (₹), taxes included'
      );

      // 4. Clamped guardrail
      expect(sanitizeClientMessage('Seller guardrail clamped price applied')).toBe(
        'Best available wholesale rate applied'
      );

      // 5. A2A auto-run
      expect(sanitizeClientMessage('A2A autonomous loop running')).toBe(
        'Auto-Negotiating best price...'
      );

      // 6. Terminal state
      expect(sanitizeClientMessage("Session is already in terminal state 'AGREED'")).toBe(
        'This negotiation has concluded.'
      );
    });
  });

  /**
   * Task 1: POST /api/v1/sessions
   */
  describe('Task 1: InitializeNegotiationSession', () => {
    it('throws pre-flight error if skuCode is empty', async () => {
      await expect(initializeNegotiationSession('', 10)).rejects.toThrow(
        'Please select an item to begin negotiation.'
      );
    });

    it('clamps quantity to range [1, 100] and sends sanitized payload', async () => {
      const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
        session_id: 'sess-001',
        data: { current_round: 1, status: 'IN_PROGRESS' },
      });

      // Quantity -5 should clamp to 1
      await initializeNegotiationSession('SKU-100', -5);
      expect(postSpy).toHaveBeenCalledWith('/sessions', {
        sku_code: 'SKU-100',
        quantity: 1,
      });

      // Quantity 500 should clamp to 100
      await initializeNegotiationSession('SKU-100', 500);
      expect(postSpy).toHaveBeenCalledWith('/sessions', {
        sku_code: 'SKU-100',
        quantity: 100,
      });
    });

    it('maps 401, 404, 429, and 422 to clean non-technical client messages', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({ status: 401 });
      await expect(initializeNegotiationSession('SKU-1', 1)).rejects.toThrow(
        'Please sign in to make a price offer.'
      );

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({ status: 404 });
      await expect(initializeNegotiationSession('SKU-1', 1)).rejects.toThrow(
        'This product is currently out of stock for negotiation.'
      );

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({ status: 429 });
      await expect(initializeNegotiationSession('SKU-1', 1)).rejects.toThrow(
        'You are starting offers too quickly. Please wait a few seconds.'
      );

      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({ status: 422 });
      await expect(initializeNegotiationSession('SKU-1', 1)).rejects.toThrow(
        'Please choose a quantity between 1 and 100.'
      );
    });
  });

  /**
   * Task 2: GET /api/v1/sessions
   */
  describe('Task 2: FetchBuyerNegotiationHistory', () => {
    it('normalizes status to uppercase and maps list defensively', async () => {
      const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: [
          {
            id: 'sess-abc',
            status: 'in_progress',
            catalog_skus: { name: 'Basmati Rice', sku_code: 'RICE-5KG', base_price: 450 },
            offer_events: [{ round_number: 1, proposed_price: 420, quantity: 5 }],
            created_at: '2026-11-01T10:00:00Z',
          },
        ],
        total: 1,
        has_more: false,
      });

      const result = await fetchBuyerNegotiationHistory(1, 'in_progress');
      expect(getSpy).toHaveBeenCalledWith('/sessions?page=1&limit=15&status=IN_PROGRESS');
      expect(result.sessions[0].status).toBe('IN_PROGRESS');
      expect(result.sessions[0].latest_counter).toBe(420);
      expect(result.sessions[0].quantity).toBe(5);
    });

    it('returns empty list gracefully without crashing on empty data sets', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: [], total: 0 });
      const result = await fetchBuyerNegotiationHistory(1, 'ALL');
      expect(result.sessions).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  /**
   * Task 3: GET /api/v1/sessions/:session_id
   */
  describe('Task 3: HydrateSessionDetails', () => {
    it('replays offer history into transcript with clean labels', async () => {
      vi.spyOn(apiClient, 'get').mockResolvedValueOnce({
        data: {
          id: 'sess-xyz',
          status: 'IN_PROGRESS',
          base_price: 1000,
          quantity: 2,
          sku_code: 'TEST-SKU',
          product_name: 'Premium Tea',
          offer_history: [
            {
              round_number: 1,
              sender: 'BUYER',
              proposed_price: 850,
              quantity: 2,
            },
            {
              round_number: 1,
              sender: 'SELLER',
              proposed_price: 920,
              quantity: 2,
              public_justification: 'Volume wholesale discount applied',
            },
          ],
        },
      });

      const details = await hydrateSessionDetails('sess-xyz');
      expect(details.session_id).toBe('sess-xyz');
      expect(details.offer_history).toHaveLength(2);
      expect(details.offer_history[0].proposed_price).toBe(850);
      expect(details.offer_history[1].public_justification).toBe('Volume wholesale discount applied');
    });

    it('maps 410 status to session timeout message', async () => {
      vi.spyOn(apiClient, 'get').mockRejectedValueOnce({ status: 410 });
      await expect(hydrateSessionDetails('expired-sess')).rejects.toThrow(
        'This negotiation has timed out due to inactivity. Please start a new offer.'
      );
    });
  });

  /**
   * Task 5: POST /api/v1/sessions/:session_id/moves
   */
  describe('Task 5: SubmitBuyerOffer', () => {
    it('validates price > 0 and qty within 1-100', async () => {
      await expect(submitBuyerOffer('sess-1', 0, 5)).rejects.toThrow(
        'Please enter a valid price greater than ₹0.'
      );
      await expect(submitBuyerOffer('sess-1', 100, 0)).rejects.toThrow(
        'Please select between 1 and 100 items.'
      );
      await expect(submitBuyerOffer('sess-1', 100, 105)).rejects.toThrow(
        'Please select between 1 and 100 items.'
      );
    });

    it('submits rounded price and parses agreed or counter status', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          status: 'AGREED',
          final_agreed_price: 880,
          counter_quantity: 10,
          message: 'Deal confirmed at wholesale rate',
        },
      });

      const res = await submitBuyerOffer('sess-1', 879.8, 10);
      expect(res.status).toBe('AGREED');
      expect(res.final_agreed_price).toBe(880);
    });
  });

  /**
   * Task 6 & 7: Accept and Decline
   */
  describe('Task 6 & 7: Accept and Decline', () => {
    it('accepts offer and maps to agreed confirmation', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: { status: 'AGREED', final_agreed_price: 900 },
      });

      const res = await acceptNegotiationDeal('sess-1');
      expect(res.success).toBe(true);
      expect(res.finalPrice).toBe(900);
    });

    it('declines offer gracefully even if network drops', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('Connection dropped'));
      const success = await declineNegotiationOffer('sess-1');
      expect(success).toBe(true);
    });
  });

  /**
   * Task 8: POST /api/v1/sessions/:session_id/a2a/step
   */
  describe('Task 8: RequestAssistantBestOffer', () => {
    it('processes assistant recommendation and seller response', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          session_id: 'sess-1',
          buyer_decision: {
            action: 'OFFER',
            offer_price: 820,
            quantity: 5,
            message: 'Suggested price: ₹820 per item based on wholesale volume.',
          },
          seller_response: {
            status: 'IN_PROGRESS',
            seller_proposed_price: 860,
            draft_justification: 'Best available wholesale rate for 5 units.',
          },
        },
      });

      const step = await requestAssistantBestOffer('sess-1', 800);
      expect(step.buyer_decision?.offer_price).toBe(820);
      expect(step.seller_response?.seller_proposed_price).toBe(860);
    });

    it('maps 400 pending review to clear 30-minute supplier window', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce({
        status: 400,
        message: 'Session is pending merchant approval.',
      });

      await expect(requestAssistantBestOffer('sess-1')).rejects.toThrow(
        'This deal is currently under manager review. Please wait.'
      );
    });
  });

  /**
   * Task 9: POST /api/v1/sessions/:session_id/a2a/auto-run
   */
  describe('Task 9: ExecuteAutonomousNegotiation', () => {
    it('replays multi-round autonomous transcript and delivers final agreed price', async () => {
      vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
        data: {
          final_status: 'AGREED',
          transcript: [
            {
              buyer_decision: { offer_price: 800, message: 'Proposing volume tier' },
              seller_response: { seller_proposed_price: 900, draft_justification: 'Counter offer' },
            },
            {
              buyer_decision: { offer_price: 850, message: 'Updated target' },
              seller_response: { seller_proposed_price: 850, draft_justification: 'Agreement reached' },
            },
          ],
          result: { final_agreed_price: 850 },
        },
      });

      const auto = await executeAutonomousNegotiation('sess-1', 800);
      expect(auto.final_status).toBe('AGREED');
      expect(auto.transcript).toHaveLength(2);
      expect(auto.result?.final_agreed_price).toBe(850);
    });
  });
});
