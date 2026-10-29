/**
 * Autonomous Buyer Agent Service for Agent-to-Agent (A2A) Negotiation
 * Feature: Autonomous Negotiation
 */

const Groq = require("groq-sdk");
require("dotenv").config();

class BuyerAgent {
  constructor(config = {}) {
    this.config = config;
    this.baseQuantity = Number(config.quantity || 1);
    this.listPrice = Number(config.list_price || 1000);
    this.targetPrice = Number(config.target_price || Math.round(this.listPrice * 0.75));
    this.walkAwayPrice = Number(config.walk_away_price || Math.round(this.listPrice * 0.88));
    this.maxBudget = Number(config.max_budget || this.baseQuantity * this.walkAwayPrice);
    this.openingOffer = Number(config.opening_offer || Math.round(this.listPrice * 0.65));
    this.maxRounds = Number(config.max_rounds || 5);
    this.currentRound = 1;
    this.history = [];
  }

  recordRound({ buyerOffer, buyerMessage, sellerCounter, sellerJustification, buyerQuantity, sellerQuantity }) {
    this.history.push({
      round: this.history.length + 1,
      buyerOffer,
      buyerMessage,
      sellerCounter,
      sellerJustification,
      buyerQuantity,
      sellerQuantity,
    });
  }

  decide(lastSellerPrice, sellerJustification, sellerQuantity = null) {
    const qty = sellerQuantity || this.baseQuantity;

    // First round opening offer
    if (lastSellerPrice == null || this.history.length === 0) {
      return {
        action: "COUNTER",
        offer_price: this.openingOffer,
        quantity: this.baseQuantity,
        message: `We are ready to place a firm procurement order for ${this.baseQuantity} units at ₹${this.openingOffer} per unit.`,
        reasoning: "Opening anchor offer at targeted wholesale margin.",
      };
    }

    const price = Number(lastSellerPrice);
    const totalOutlay = price * qty;

    // Check acceptance conditions:
    // 1. Seller price meets or beats target price
    // 2. Or seller price <= walkaway price and total outlay within max budget
    // 3. Or final round and price is reasonable
    const isAtOrBelowTarget = price <= this.targetPrice;
    const isWithinBudget = totalOutlay <= this.maxBudget;
    const isFinalRound = this.currentRound >= this.maxRounds;

    if (isAtOrBelowTarget && isWithinBudget) {
      return {
        action: "ACCEPT",
        offer_price: price,
        quantity: qty,
        message: `We accept your offer of ₹${price} per unit for ${qty} units. Please proceed with order settlement.`,
        reasoning: "Seller counter met target price and stays within budget.",
      };
    }

    if (price <= this.walkAwayPrice && isWithinBudget && (isFinalRound || this.history.length >= 3)) {
      return {
        action: "ACCEPT",
        offer_price: price,
        quantity: qty,
        message: `We accept the revised price of ₹${price} per unit for ${qty} units to finalize the procurement.`,
        reasoning: "Price meets walkaway threshold and concludes round budget limit.",
      };
    }

    // If price exceeds walkaway on the final round, walk away
    if (isFinalRound && price > this.walkAwayPrice) {
      return {
        action: "WALK_AWAY",
        offer_price: null,
        quantity: qty,
        message: `Your counter-offer of ₹${price} exceeds our procurement cap of ₹${this.walkAwayPrice}. We must pass at this time.`,
        reasoning: "Final round seller price breached maximum acceptable outlay.",
      };
    }

    // Otherwise, generate progressive concession offer (conceding 3-5% toward seller)
    const lastBuyerOffer = this.history[this.history.length - 1]?.buyerOffer || this.openingOffer;
    const gap = price - lastBuyerOffer;
    const stepConcession = Math.max(Math.round(gap * 0.4), Math.round(this.targetPrice * 0.04));
    let nextOffer = Math.min(lastBuyerOffer + stepConcession, this.walkAwayPrice);
    nextOffer = Math.round(nextOffer);

    // If next offer is too close to seller's price, just accept
    if (nextOffer >= price && totalOutlay <= this.maxBudget) {
      return {
        action: "ACCEPT",
        offer_price: price,
        quantity: qty,
        message: `We accept your price of ₹${price} per unit for ${qty} units.`,
        reasoning: "Remaining price gap is minimal, closing the transaction.",
      };
    }

    return {
      action: "COUNTER",
      offer_price: nextOffer,
      quantity: qty,
      message: `We can increase our bid to ₹${nextOffer} per unit for ${qty} units. We are prepared to settle immediately at this rate.`,
      reasoning: `Conceding gap incrementally: proposed ₹${nextOffer} within budget cap.`,
    };
  }
}

module.exports = BuyerAgent;
