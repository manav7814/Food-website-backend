const mongoose = require("mongoose");

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"]
    },
    description: {
      type: String,
      default: ""
    },
    image: {
      type: String,
      default: ""
    },
    link: {
      type: String,
      default: ""
    },
    linkType: {
      type: String,
      enum: ["none", "menu", "category", "custom"],
      default: "none"
    },
    category: {
      type: String,
      default: ""
    },
    position: {
      type: Number,
      default: 0
    },
    isActive: {
      type: Boolean,
      default: true
    },
    startDate: {
      type: Date
    },
    endDate: {
      type: Date
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

// Index for efficient querying
bannerSchema.index({ isActive: 1, position: 1 });
bannerSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model("Banner", bannerSchema);
