const express = require("express");
const jwt = require("jsonwebtoken");
const Order = require("../models/Order");
const MenuItem = require("../models/MenuItem");
const Payment = require("../models/Payment");
const Offer = require("../models/Offer");
const Restaurant = require("../models/Restaurant");
const SystemSettings = require("../models/SystemSettings");

const router = express.Router();

const SYSTEM_PROMPT = "You are an intelligent assistant for a food ordering platform.";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const GEMINI_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const ORDER_ID_REGEX = /\b[a-fA-F0-9]{24}\b/;
const PINCODE_REGEX = /\b\d{6}\b/;
const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

const detectIntent = (message = "") => {
  const text = message.toLowerCase();

  if (/(where is my order|track|order status|status of my order)/.test(text)) return "order_tracking";
  if (/(suggest|recommend|budget|veg|vegan|spicy|healthy|low calorie|dessert)/.test(text)) return "food_suggestion";
  if (/(refund|money back|return payment|cancel and refund)/.test(text)) return "refund";
  if (/(deliver|delivery availability|service area|do you deliver|pincode|pin code)/.test(text)) {
    return "delivery_availability";
  }
  if (/(popular|best seller|bestseller|trending|most ordered)/.test(text)) return "popular_dishes";
  return "general";
};

const parseBudget = (message = "") => {
  const budgetMatch = message.match(/(?:₹|rs\.?|inr)?\s*(\d{2,5})/i);
  if (!budgetMatch) return null;
  const value = Number(budgetMatch[1]);
  return Number.isFinite(value) ? value : null;
};

const toPaymentLabel = (method) => {
  const labels = {
    upi: "UPI",
    card: "Card",
    netbanking: "Net Banking",
    wallet: "Wallet",
    cod: "Cash on Delivery"
  };
  return labels[method] || method;
};

const extractPincode = (message = "") => {
  const matched = message.match(PINCODE_REGEX);
  return matched ? matched[0] : null;
};

const extractOrderId = ({ orderId, message }) => {
  if (orderId && ORDER_ID_REGEX.test(orderId)) return orderId;
  const matched = message.match(ORDER_ID_REGEX);
  return matched ? matched[0] : null;
};

const summarizeOrder = (order) => {
  if (!order) return null;
  return {
    orderId: String(order._id),
    status: order.status,
    orderStatus: order.orderStatus,
    estimatedDeliveryTime: order.estimatedDeliveryTime || null,
    paymentStatus: order.paymentStatus,
    totalPrice: order.totalPrice,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
};

const optionalAuth = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    req.user = null;
  }

  return next();
};

const getMongoFaqContext = async ({ intent, message }) => {
  const [paymentMethods, restaurants, refundCount, activeOffers, deliveryConfig] = await Promise.all([
    Payment.distinct("paymentMethod"),
    Restaurant.find().select("name deliveryTime cuisine").limit(5).lean(),
    Order.countDocuments({ paymentStatus: "refunded" }),
    Offer.find({
      isActive: true,
      startDate: { $lte: new Date() },
      endDate: { $gte: new Date() }
    })
      .select("code name discountType discountValue minOrderValue endDate")
      .limit(5)
      .lean(),
    SystemSettings.findOne({ key: "RESTAURANT_DELIVERY_CONFIG" }).lean()
  ]);

  const context = {
    paymentMethods: paymentMethods.map(toPaymentLabel),
    restaurantDeliveryInfo: restaurants.map((item) => ({
      name: item.name,
      cuisine: item.cuisine,
      deliveryTime: item.deliveryTime
    })),
    refundedOrdersCount: refundCount,
    activeOffers: activeOffers.map((offer) => ({
      code: offer.code,
      name: offer.name,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      minOrderValue: offer.minOrderValue,
      validTill: offer.endDate
    })),
    deliveryConfig: deliveryConfig?.value || null
  };

  if (intent === "delivery_availability") {
    const pincode = extractPincode(message);
    if (pincode) {
      const configuredPincodes = Array.isArray(deliveryConfig?.value?.servicePincodes)
        ? deliveryConfig.value.servicePincodes.map(String)
        : [];
      if (configuredPincodes.length > 0) {
        context.deliveryAvailabilityCheck = {
          pincode,
          isAvailable: configuredPincodes.includes(String(pincode)),
          source: "SystemSettings.RESTAURANT_DELIVERY_CONFIG.servicePincodes"
        };
      } else {
        context.deliveryAvailabilityCheck = {
          pincode,
          isAvailable: null,
          source: "No servicePincodes configured in SystemSettings"
        };
      }
    }
  }

  return context;
};

const buildGeminiTranscript = ({ contextText, history, userMessage }) => {
  const transcript = [];
  transcript.push("System prompt:");
  transcript.push(SYSTEM_PROMPT);
  transcript.push("");
  transcript.push("Context:");
  transcript.push(contextText);
  transcript.push("");
  transcript.push("Conversation:");

  for (const entry of history) {
    transcript.push(`${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.content}`);
  }
  transcript.push(`User: ${userMessage}`);
  transcript.push("Assistant:");

  return transcript.join("\n");
};

const callOpenAI = async ({ messages }) => {
  const completionRes = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.5,
      messages
    })
  });

  const completionData = await completionRes.json();
  if (!completionRes.ok) {
    throw new Error(completionData?.error?.message || "OpenAI request failed");
  }

  return completionData?.choices?.[0]?.message?.content?.trim() || "";
};

const callGemini = async ({ contextText, history, userMessage }) => {
  const preferredModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = await resolveGeminiModel(preferredModel);
  const url = `${GEMINI_URL_BASE}/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const prompt = buildGeminiTranscript({ contextText, history, userMessage });

  const geminiRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5 }
    })
  });

  const geminiData = await geminiRes.json();
  if (!geminiRes.ok) {
    throw new Error(geminiData?.error?.message || "Gemini request failed");
  }

  const parts = geminiData?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("\n").trim();
};

const listGeminiModels = async () => {
  const url = `${GEMINI_URL_BASE}?key=${process.env.GEMINI_API_KEY}`;
  const listRes = await fetch(url);
  const listData = await listRes.json();
  if (!listRes.ok) return [];

  const models = Array.isArray(listData.models) ? listData.models : [];
  return models
    .filter((model) => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes("generateContent"))
    .map((model) => String(model.name || "").replace(/^models\//, ""))
    .filter(Boolean);
};

const resolveGeminiModel = async (preferredModel) => {
  const available = await listGeminiModels();
  if (available.length === 0) {
    return preferredModel;
  }

  if (available.includes(preferredModel)) {
    return preferredModel;
  }

  for (const fallback of GEMINI_FALLBACK_MODELS) {
    if (available.includes(fallback)) {
      return fallback;
    }
  }

  return available[0];
};

router.post("/", optionalAuth, async (req, res) => {
  try {
    const { message, history = [], orderId } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ message: "message is required" });
    }

    const trimmedMessage = message.trim();
    const intent = detectIntent(trimmedMessage);
    const chatContext = [];
    const mongoFaqContext = await getMongoFaqContext({ intent, message: trimmedMessage });

    chatContext.push(
      "FAQ context:",
      "- Use MongoDB context below as source of truth for delivery time, refunds, payment methods, offers, and availability.",
      "- If data is missing in MongoDB context, clearly say data is unavailable instead of guessing.",
      `MongoDB FAQ context: ${JSON.stringify(mongoFaqContext)}`
    );

    if (intent === "order_tracking") {
      let trackedOrder = null;
      const trackedOrderId = extractOrderId({ orderId, message: trimmedMessage });

      if (trackedOrderId) {
        trackedOrder = await Order.findById(trackedOrderId).select(
          "_id user status orderStatus estimatedDeliveryTime paymentStatus totalPrice createdAt updatedAt"
        );
      } else if (req.user?.id) {
        trackedOrder = await Order.findOne({ user: req.user.id }).sort({ createdAt: -1 });
      }

      if (trackedOrder && req.user?.id && req.user.role !== "admin" && req.user.role !== "super_admin") {
        if (String(trackedOrder.user) !== String(req.user.id)) {
          return res.status(403).json({ message: "Not authorized to access this order" });
        }
      }

      if (trackedOrder) {
        chatContext.push(`Order tracking context: ${JSON.stringify(summarizeOrder(trackedOrder))}`);
      } else {
        chatContext.push(
          "Order tracking context: No order found. Ask the user for a valid order ID or ask them to log in to fetch latest order."
        );
      }
    }

    if (intent === "popular_dishes") {
      const popular = await Order.aggregate([
        { $unwind: "$items" },
        { $group: { _id: "$items.name", totalOrdered: { $sum: "$items.quantity" } } },
        { $sort: { totalOrdered: -1 } },
        { $limit: 5 }
      ]);
      if (popular.length > 0) {
        chatContext.push(`Popular dishes context: ${JSON.stringify(popular)}`);
      }
    }

    if (intent === "food_suggestion") {
      const budget = parseBudget(trimmedMessage);
      const filter = budget ? { price: { $lte: budget } } : {};
      const menuItems = await MenuItem.find(filter).sort({ price: 1 }).limit(6).select("name category price");
      chatContext.push(`Food suggestion context: ${JSON.stringify({ budget, menuItems })}`);
    }

    if (intent === "delivery_availability") {
      chatContext.push(
        "Delivery availability context: Ask for area/pincode if missing and then confirm whether it is serviceable."
      );
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter((entry) => entry && typeof entry.content === "string" && ["user", "assistant"].includes(entry.role))
          .slice(-10)
      : [];

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: chatContext.join("\n") },
      ...safeHistory.map((entry) => ({ role: entry.role, content: entry.content })),
      { role: "user", content: trimmedMessage }
    ];

    const provider = (process.env.CHAT_PROVIDER || "").toLowerCase();
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
    const shouldUseGemini = provider === "gemini" || (!provider && hasGemini && !hasOpenAI);
    const shouldUseOpenAI = provider === "openai" || (!provider && hasOpenAI);

    if (!hasGemini && !hasOpenAI) {
      return res.status(500).json({ message: "No AI provider configured (set GEMINI_API_KEY or OPENAI_API_KEY)" });
    }

    let reply = "";
    if (shouldUseGemini) {
      reply = await callGemini({
        contextText: chatContext.join("\n"),
        history: safeHistory,
        userMessage: trimmedMessage
      });
    } else if (shouldUseOpenAI) {
      reply = await callOpenAI({ messages });
    } else if (hasGemini) {
      reply = await callGemini({
        contextText: chatContext.join("\n"),
        history: safeHistory,
        userMessage: trimmedMessage
      });
    }

    if (!reply) {
      return res.status(502).json({ message: "No response from AI model" });
    }

    return res.json({ reply, intent });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Chat request failed" });
  }
});

module.exports = router;
