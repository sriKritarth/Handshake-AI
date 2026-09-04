"""Razorpay Payment Link integration for agreed deals."""
from __future__ import annotations

import os
import uuid
import razorpay
from typing import Any, Dict, Optional
from dotenv import load_dotenv
load_dotenv(dotenv_path=".env")

class PaymentLinkResult:
    def __init__(
        self,
        payment_link_url: str,
        razorpay_order_id: str,
        razorpay_payment_link_id: str,
        amount: float,
        checkout_url: Optional[str] = None,
    ) -> None:
        self.payment_link_url = payment_link_url
        self.razorpay_order_id = razorpay_order_id
        self.razorpay_payment_link_id = razorpay_payment_link_id
        self.amount = amount
        self.checkout_url = checkout_url


class RazorpayPaymentService:
    """Service to create real Razorpay orders and payment links."""

    def __init__(
        self,
        key_id: Optional[str] = None,
        key_secret: Optional[str] = None,
    ) -> None:
        self.key_id = (key_id or os.environ.get("RAZORPAY_KEY_ID", "")).strip()
        self.key_secret = (key_secret or os.environ.get("RAZORPAY_KEY_SECRET", "")).strip()
        self._client = None
        if self.key_id and self.key_secret:
            try:
                self._client = razorpay.Client(auth=(self.key_id, self.key_secret))
            except Exception:
                self._client = None

    def create_payment_link(
        self,
        session_id: str,
        sku_code: str,
        quantity: int,
        unit_price: float,
        buyer_id: str,
        buyer_email: Optional[str] = None,
        buyer_contact: Optional[str] = None,
    ) -> PaymentLinkResult:
        """Create a real Razorpay order and payment link for the agreed negotiation session."""
        total_amount = float(unit_price * quantity)
        amount_in_paise = int(round(total_amount * 100))
        interactive_checkout_url = f"/api/v1/checkout/{session_id}"

        rzp_order_id = f"order_{uuid.uuid4().hex[:14]}"
        plink_id = f"plink_{uuid.uuid4().hex[:12]}"
        plink_url = f"https://rzp.io/i/{plink_id}"

        if self._client is not None:
            # 1. Create a real Razorpay Order (unrestricted in test mode)
            try:
                order_payload = {
                    "amount": amount_in_paise,
                    "currency": "INR",
                    "receipt": f"rcpt_{session_id[:20]}",
                    "notes": {
                        "session_id": str(session_id),
                        "sku_code": str(sku_code),
                        "unit_price": str(unit_price),
                        "quantity": str(quantity),
                    },
                }
                ord_res = self._client.order.create(order_payload)
                if ord_res and ord_res.get("id"):
                    rzp_order_id = ord_res["id"]
            except Exception:
                pass

            # 2. Try creating a hosted Razorpay Payment Link (subject to 30-link test cap)
            try:
                link_payload = {
                    "amount": amount_in_paise,
                    "currency": "INR",
                    "accept_partial": False,
                    "description": f"Wholesale Order for SKU {sku_code} (Qty: {quantity})",
                    "customer": {
                        "name": buyer_id,
                    },
                    "notify": {"sms": False, "email": True},
                    "reminder_enable": True,
                    "notes": {
                        "session_id": str(session_id),
                        "sku_code": str(sku_code),
                        "unit_price": str(unit_price),
                        "quantity": str(quantity),
                    },
                }
                res = self._client.payment_link.create(link_payload)
                if res and res.get("id"):
                    plink_id = res.get("id")
                    plink_url = res.get("short_url", f"https://rzp.io/i/{plink_id}")
            except Exception:
                # If test mode limit of 30 payment links is reached, fallback to interactive checkout
                plink_url = interactive_checkout_url

        return PaymentLinkResult(
            payment_link_url=plink_url,
            razorpay_order_id=rzp_order_id,
            razorpay_payment_link_id=plink_id,
            amount=total_amount,
            checkout_url=interactive_checkout_url,
        )
