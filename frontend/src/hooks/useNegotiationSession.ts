'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initializeNegotiationSession,
  hydrateSessionDetails,
  submitBuyerOffer,
  acceptNegotiationDeal,
  declineNegotiationOffer,
  requestAssistantBestOffer,
  executeAutonomousNegotiation,
  sanitizeClientMessage,
  type SessionDetail,
  type OfferEvent,
} from '../api/negotiation';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import type { CatalogSku } from '../api/schemas';

export interface ChatMessage {
  id: string;
  sender: 'BUYER' | 'SELLER' | 'SYSTEM' | 'ASSISTANT';
  text: string;
  price?: number;
  quantity?: number;
  timestamp: string;
}

export interface QuoteState {
  unitPrice: number;
  quantity: number;
  accepted: boolean;
}

export function useNegotiationSession(initialSessionId: string | null = null) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [currentQuote, setCurrentQuote] = useState<QuoteState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('IN_PROGRESS');

  const sseRef = useRef<EventSource | null>(null);
  const { addDeal, notify } = useCart();
  const { isAuthenticated } = useAuth();

  const appendMessage = useCallback(
    (
      sender: ChatMessage['sender'],
      text: string,
      price?: number,
      quantity?: number
    ) => {
      const cleanText = sanitizeClientMessage(text);
      if (!cleanText) return;

      const newMessage: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        sender,
        text: cleanText,
        price,
        quantity,
        timestamp: new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setTranscript((prev) => [...prev, newMessage]);
    },
    []
  );

  // Close active EventSource cleanly
  const closeStream = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
      setIsLiveConnected(false);
    }
  }, []);

  /**
   * Task 4: GET /api/v1/sessions/:session_id/stream
   * ALGORITHM: ManageSessionEventStream(sessionId)
   */
  const connectStream = useCallback(
    (activeId: string) => {
      closeStream();

      if (typeof window === 'undefined') return;
      const token = localStorage.getItem('auth_token');
      if (!token) return;

      try {
        const streamUrl = `/api/v1/sessions/${encodeURIComponent(activeId)}/stream?token=${encodeURIComponent(token)}`;
        const es = new EventSource(streamUrl);
        sseRef.current = es;

        es.addEventListener('connected', () => {
          setIsLiveConnected(true);
        });

        es.addEventListener('offer_event', (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            const event: OfferEvent = payload.event || payload;
            const senderUpper = String(event.sender || 'SELLER').toUpperCase();

            if (senderUpper !== 'BUYER') {
              const price = event.proposed_price || event.guardrail_clamped_price || 0;
              const qty = event.quantity || session?.quantity || 1;
              const msg =
                event.public_justification ||
                `Counter offer: ₹${price} each for ${qty} item${qty === 1 ? '' : 's'}.`;

              appendMessage('SELLER', msg, price, qty);
              setCurrentQuote({ unitPrice: price, quantity: qty, accepted: false });
            }
          } catch {}
        });

        es.addEventListener('session_status', (e: MessageEvent) => {
          try {
            const payload = JSON.parse(e.data);
            const newStatus = String(payload.status || '').toUpperCase();
            if (newStatus) {
              setStatus(newStatus);
              if (newStatus === 'AGREED') {
                setCurrentQuote((prev) => (prev ? { ...prev, accepted: true } : null));
                appendMessage('SYSTEM', 'Agreement reached! Ready for checkout.');
              } else if (newStatus === 'REJECTED') {
                appendMessage('SYSTEM', 'This offer has been closed.');
              }
            }
          } catch {}
        });

        es.onerror = () => {
          setIsLiveConnected(false);
          if (es.readyState === EventSource.CLOSED) {
            sseRef.current = null;
          }
        };
      } catch {
        setIsLiveConnected(false);
      }
    },
    [closeStream, appendMessage, session?.quantity]
  );

  /**
   * Task 3: Hydrate session details on open or resume
   */
  const hydrate = useCallback(
    async (targetSessionId: string) => {
      setIsBusy(true);
      setErrorText(null);

      try {
        const detail = await hydrateSessionDetails(targetSessionId);
        setSession(detail);
        setStatus(detail.status);
        setSessionId(detail.session_id);

        // Replay offer history into chat
        const replayedMessages: ChatMessage[] = [];
        for (const ev of detail.offer_history) {
          const isBuyer = ev.sender === 'BUYER';
          const qty = ev.quantity || detail.quantity || 1;
          const text = isBuyer
            ? `You offered ₹${ev.proposed_price} for ${qty} item${qty === 1 ? '' : 's'}.`
            : ev.public_justification ||
              `Seller counter-offer: ₹${ev.proposed_price} for ${qty} item${qty === 1 ? '' : 's'}.`;

          replayedMessages.push({
            id: `replay-${ev.round_number}-${ev.sender}`,
            sender: isBuyer ? 'BUYER' : 'SELLER',
            text: sanitizeClientMessage(text),
            price: ev.proposed_price,
            quantity: qty,
            timestamp: ev.created_at
              ? new Date(ev.created_at).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Earlier',
          });
        }

        if (replayedMessages.length === 0) {
          replayedMessages.push({
            id: 'init-greeting',
            sender: 'SELLER',
            text: 'Welcome! What price per item works for you? Enter your offer below.',
            timestamp: new Date().toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          });
        }

        setTranscript(replayedMessages);

        if (detail.status === 'AGREED' && detail.final_agreed_price) {
          setCurrentQuote({
            unitPrice: detail.final_agreed_price,
            quantity: detail.quantity,
            accepted: true,
          });
        } else if (detail.latest_seller_price) {
          setCurrentQuote({
            unitPrice: detail.latest_seller_price,
            quantity: detail.quantity,
            accepted: false,
          });
        }

        // Connect SSE stream
        connectStream(detail.session_id);
      } catch (err: any) {
        setErrorText(err.message || 'Unable to load negotiation session.');
      } finally {
        setIsBusy(false);
      }
    },
    [connectStream]
  );

  // Initialize or hydrate when initialSessionId changes
  useEffect(() => {
    if (initialSessionId) {
      hydrate(initialSessionId);
    }
    return () => {
      closeStream();
    };
  }, [initialSessionId, hydrate, closeStream]);

  /**
   * Task 1: Create session
   */
  const initSession = async (
    skuCode: string,
    requestedQty: number,
    productName = 'Product'
  ): Promise<string> => {
    setIsBusy(true);
    setErrorText(null);
    setTranscript([]);

    try {
      const result = await initializeNegotiationSession(skuCode, requestedQty);
      const newId = result.session_id;
      setSessionId(newId);
      setStatus('IN_PROGRESS');

      // Set initial greeting
      setTranscript([
        {
          id: 'welcome',
          sender: 'SELLER',
          text: `Welcome! Let us find a fair price for ${requestedQty} units of ${productName}. Enter your offer below.`,
          timestamp: new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      ]);

      connectStream(newId);
      return newId;
    } catch (err: any) {
      setErrorText(err.message || 'Could not start negotiation.');
      throw err;
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Task 5: Submit Counter-Offer
   */
  const submitOffer = async (
    targetPrice: number | string,
    quantity: number | string,
    message = ''
  ) => {
    if (!sessionId || isBusy) return;

    const priceNum = Math.round(Number(targetPrice));
    const qtyNum = Math.floor(Number(quantity));

    // Optimistic user bubble
    appendMessage(
      'BUYER',
      message
        ? `${qtyNum} × ₹${priceNum} each · "${message}"`
        : `${qtyNum} × ₹${priceNum} each · ₹${qtyNum * priceNum} total`,
      priceNum,
      qtyNum
    );

    setIsBusy(true);
    setErrorText(null);

    try {
      const res = await submitBuyerOffer(sessionId, priceNum, qtyNum, message);
      setStatus(res.status);

      if (res.status === 'AGREED') {
        const finalPrice = res.final_agreed_price || priceNum;
        appendMessage(
          'SELLER',
          `Deal agreed! Price confirmed at ₹${finalPrice} each.`,
          finalPrice,
          res.counter_quantity || qtyNum
        );
        setCurrentQuote({
          unitPrice: finalPrice,
          quantity: res.counter_quantity || qtyNum,
          accepted: true,
        });
      } else if (res.seller_proposed_price) {
        const note =
          res.draft_justification ||
          `Seller counter-offer: ₹${res.seller_proposed_price} each.`;
        appendMessage(
          'SELLER',
          note,
          res.seller_proposed_price,
          res.counter_quantity || qtyNum
        );
        setCurrentQuote({
          unitPrice: res.seller_proposed_price,
          quantity: res.counter_quantity || qtyNum,
          accepted: false,
        });
      } else if (res.draft_justification) {
        appendMessage('SELLER', res.draft_justification);
      }
    } catch (err: any) {
      setErrorText(err.message || 'Could not send offer.');
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Task 6: Accept Offer & Checkout Handoff
   */
  const acceptDeal = async (product: CatalogSku, onAccepted?: () => void) => {
    if (!sessionId || isBusy) return;

    setIsBusy(true);
    setErrorText(null);

    try {
      await acceptNegotiationDeal(sessionId);
      setStatus('AGREED');

      const unitPrice = currentQuote?.unitPrice || product.base_price;
      const quantity = currentQuote?.quantity || session?.quantity || 1;

      addDeal({
        sessionId,
        skuCode: product.sku_code,
        name: product.name,
        quantity,
        unitPrice,
        listPrice: product.base_price,
        imageUrl: product.secure_url || product.Image_url || product.image_url,
      });

      notify('Deal confirmed! Added to your bag at the agreed price.');
      closeStream();
      if (onAccepted) onAccepted();
    } catch (err: any) {
      setErrorText(err.message || 'Unable to confirm this deal.');
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Task 7: Decline Offer & Conclude
   */
  const declineOffer = async (onDeclined?: () => void) => {
    if (!sessionId || isBusy) return;

    setIsBusy(true);
    try {
      await declineNegotiationOffer(sessionId);
      setStatus('REJECTED');
      closeStream();
      appendMessage('SYSTEM', 'You declined the offer and concluded negotiations.');
      notify('Negotiation ended. Offer declined.');

      setTimeout(() => {
        if (onDeclined) onDeclined();
      }, 800);
    } catch (err: any) {
      setErrorText(err.message || 'Failed to decline offer.');
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Task 8: Suggest Best Price / AI Assistant Step
   */
  const suggestBestPrice = async (targetPrice?: number) => {
    if (!sessionId || isBusy) return;

    setIsBusy(true);
    setErrorText(null);

    try {
      const res = await requestAssistantBestOffer(sessionId, targetPrice);
      setStatus(res.status);

      if (res.buyer_decision?.message) {
        appendMessage(
          'ASSISTANT',
          res.buyer_decision.message,
          res.buyer_decision.offer_price,
          res.buyer_decision.quantity
        );
      }

      if (res.seller_response) {
        if (res.seller_response.status === 'AGREED') {
          const finalPrice =
            res.seller_response.final_agreed_price || res.buyer_decision?.offer_price || 0;
          appendMessage(
            'SELLER',
            `Deal agreed with seller at ₹${finalPrice} each!`,
            finalPrice,
            session?.quantity
          );
          setCurrentQuote({
            unitPrice: finalPrice,
            quantity: session?.quantity || 1,
            accepted: true,
          });
        } else if (res.seller_response.seller_proposed_price) {
          const note =
            res.seller_response.draft_justification ||
            `Seller countered with ₹${res.seller_response.seller_proposed_price} each.`;
          appendMessage(
            'SELLER',
            note,
            res.seller_response.seller_proposed_price,
            session?.quantity
          );
          setCurrentQuote({
            unitPrice: res.seller_response.seller_proposed_price,
            quantity: session?.quantity || 1,
            accepted: false,
          });
        }
      }
    } catch (err: any) {
      setErrorText(err.message || 'Pricing assistant is currently unavailable.');
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Task 9: Autonomous Multi-Round Auto-Run
   */
  const autoNegotiate = async (targetPrice?: number) => {
    if (!sessionId || isBusy) return;

    setIsBusy(true);
    setErrorText(null);
    appendMessage('SYSTEM', 'Finding the best possible wholesale discount for you...');

    try {
      const res = await executeAutonomousNegotiation(sessionId, targetPrice);
      setStatus(res.final_status);

      // Replay all autonomous rounds
      for (const round of res.transcript) {
        if (round.buyer_decision?.message) {
          appendMessage('ASSISTANT', round.buyer_decision.message, round.buyer_decision.offer_price);
        }
        if (round.seller_response?.draft_justification) {
          appendMessage(
            'SELLER',
            round.seller_response.draft_justification,
            round.seller_response.seller_proposed_price
          );
        }
      }

      if (res.final_status === 'AGREED') {
        const finalPrice =
          res.result?.final_agreed_price || res.result?.seller_proposed_price || 0;
        setCurrentQuote({
          unitPrice: finalPrice,
          quantity: session?.quantity || 1,
          accepted: true,
        });
        notify('Best wholesale price agreed!');
      } else if (res.final_status === 'PENDING_APPROVAL') {
        notify('Discount request submitted for supplier manager review (30-minute review window).');
      } else if (res.final_status === 'REJECTED') {
        notify('Supplier could not meet target price. Negotiation closed.');
      }
    } catch (err: any) {
      setErrorText(err.message || 'Could not complete auto-negotiation.');
    } finally {
      setIsBusy(false);
    }
  };

  return {
    sessionId,
    session,
    transcript,
    currentQuote,
    isBusy,
    isLiveConnected,
    errorText,
    status,
    initSession,
    hydrate,
    submitOffer,
    acceptDeal,
    declineOffer,
    suggestBestPrice,
    autoNegotiate,
    closeStream,
    setErrorText,
  };
}
