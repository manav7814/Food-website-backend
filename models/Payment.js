const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: "INR"
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending"
    },
    paymentMethod: {
      type: String,
      enum: ["card", "upi", "netbanking", "wallet", "cod"],
      default: "card"
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true
    },
    cardLast4: {
      type: String
    },
    cardBrand: {
      type: String
    },
    failureReason: {
      type: String
    },
    codConfirmed: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Generate transaction ID before saving
paymentSchema.pre("save", async function (next) {
  if (!this.transactionId) {
    this.transactionId = "TXN-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

module.exports = mongoose.model("Payment", paymentSchema);
