const express = require("express");
const { query } = require("express-validator");
const Order = require("../models/Order");
const Payment = require("../models/Payment");
const Driver = require("../models/Driver");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

// Commission rate (percentage)
const COMMISSION_RATE = 15; // 15% commission on each order

// GST rate
const GST_RATE = 18; // 18% GST

// ============================================
// REVENUE BREAKDOWN
// ============================================

// Get revenue breakdown
router.get(
  "/revenue",
  protect,
  adminOnly,
  [
    query("startDate").optional().isISO8601().withMessage("Invalid start date"),
    query("endDate").optional().isISO8601().withMessage("Invalid end date"),
    query("period").optional().isIn(["daily", "weekly", "monthly", "yearly"]).withMessage("Invalid period")
  ],
  validate,
  async (req, res) => {
    try {
      const { startDate, endDate, period } = req.query;
      
      // Build date filter
      let dateFilter = {};
      const now = new Date();
      
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      } else if (period) {
        let start;
        switch (period) {
          case "daily":
            start = new Date(now.setHours(0, 0, 0, 0));
            break;
          case "weekly":
            start = new Date(now.setDate(now.getDate() - 7));
            break;
          case "monthly":
            start = new Date(now.setMonth(now.getMonth() - 1));
            break;
          case "yearly":
            start = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
        }
        dateFilter = { createdAt: { $gte: start } };
      }

      // Get all delivered orders with payments
      const orders = await Order.find({
        status: "delivered",
        paymentStatus: "paid",
        ...dateFilter
      }).populate("user", "name email").populate("driver", "name phone");

      // Calculate revenue breakdown
      const totalRevenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);
      const totalDeliveryFees = orders.reduce((sum, order) => sum + (order.deliveryFee || 0), 0);
      const totalDriverEarnings = orders.reduce((sum, order) => sum + (order.driverEarning || 0), 0);
      const platformCommission = orders.reduce((sum, order) => {
        const orderCommission = (order.totalPrice - (order.deliveryFee || 0)) * (COMMISSION_RATE / 100);
        return sum + orderCommission;
      }, 0);
      
      const netRevenue = totalRevenue - totalDriverEarnings;

      // Revenue by payment method
      const payments = await Payment.find({
        status: "completed",
        ...dateFilter
      });
      
      const revenueByPaymentMethod = {};
      payments.forEach(payment => {
        const method = payment.paymentMethod || "unknown";
        revenueByPaymentMethod[method] = (revenueByPaymentMethod[method] || 0) + payment.amount;
      });

      // Revenue by day/week/month
      const revenueByPeriod = {};
      orders.forEach(order => {
        const date = new Date(order.createdAt).toISOString().split("T")[0];
        revenueByPeriod[date] = (revenueByPeriod[date] || 0) + order.totalPrice;
      });

      // Orders count
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Completed vs COD orders
      const completedPayments = payments.length;
      const codOrders = orders.filter(o => o.paymentMethod === "cod").length;

      res.json({
        totalRevenue,
        totalDeliveryFees,
        totalDriverEarnings,
        platformCommission,
        netRevenue,
        totalOrders,
        averageOrderValue,
        revenueByPaymentMethod,
        revenueByPeriod,
        completedPayments,
        codOrders,
        period: period || "all",
        dateRange: {
          start: startDate || null,
          end: endDate || null
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// DRIVER COMMISSION CALCULATION
// ============================================

// Get driver commissions
router.get(
  "/driver-commissions",
  protect,
  adminOnly,
  [
    query("startDate").optional().isISO8601().withMessage("Invalid start date"),
    query("endDate").optional().isISO8601().withMessage("Invalid end date")
  ],
  validate,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      }

      // Get all delivered orders
      const orders = await Order.find({
        status: "delivered",
        driver: { $exists: true, $ne: null },
        ...dateFilter
      }).populate("driver", "name phone vehicleType totalDeliveries walletBalance");

      // Group orders by driver
      const driverCommissions = {};
      
      orders.forEach(order => {
        if (!order.driver) return;
        
        const driverId = order.driver._id.toString();
        const orderAmount = order.totalPrice - (order.deliveryFee || 0);
        const commission = orderAmount * (COMMISSION_RATE / 100);
        const driverEarning = order.driverEarning || (order.deliveryFee || 0);

        if (!driverCommissions[driverId]) {
          driverCommissions[driverId] = {
            driver: order.driver,
            totalDeliveries: 0,
            totalOrderValue: 0,
            totalCommission: 0,
            totalDriverEarnings: 0,
            orders: []
          };
        }

        driverCommissions[driverId].totalDeliveries += 1;
        driverCommissions[driverId].totalOrderValue += orderAmount;
        driverCommissions[driverId].totalCommission += commission;
        driverCommissions[driverId].totalDriverEarnings += driverEarning;
        driverCommissions[driverId].orders.push({
          orderId: order._id,
          orderDate: order.createdAt,
          orderValue: orderAmount,
          commission,
          driverEarning,
          deliveryFee: order.deliveryFee || 0
        });
      });

      // Convert to array and calculate totals
      const commissionData = Object.values(driverCommissions).map(driver => ({
        driverId: driver.driver._id,
        driverName: driver.driver.name,
        driverPhone: driver.driver.phone,
        vehicleType: driver.driver.vehicleType,
        totalDeliveries: driver.totalDeliveries,
        totalOrderValue: driver.totalOrderValue,
        totalCommission: driver.totalCommission,
        totalDriverEarnings: driver.totalDriverEarnings,
        averagePerDelivery: driver.totalDeliveries > 0 
          ? driver.totalDriverEarnings / driver.totalDeliveries 
          : 0,
        orders: driver.orders
      }));

      // Calculate totals
      const totalCommission = commissionData.reduce((sum, d) => sum + d.totalCommission, 0);
      const totalDriverEarnings = commissionData.reduce((sum, d) => sum + d.totalDriverEarnings, 0);

      res.json({
        drivers: commissionData,
        summary: {
          totalDrivers: commissionData.length,
          totalDeliveries: commissionData.reduce((sum, d) => sum + d.totalDeliveries, 0),
          totalOrderValue: commissionData.reduce((sum, d) => sum + d.totalOrderValue, 0),
          totalCommission,
          totalDriverEarnings,
          commissionRate: COMMISSION_RATE
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Get individual driver commission details
router.get(
  "/driver-commissions/:driverId",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { driverId } = req.params;
      const { startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      }

      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const orders = await Order.find({
        status: "delivered",
        driver: driverId,
        ...dateFilter
      }).sort({ createdAt: -1 });

      const orderDetails = orders.map(order => {
        const orderAmount = order.totalPrice - (order.deliveryFee || 0);
        const commission = orderAmount * (COMMISSION_RATE / 100);
        const driverEarning = order.driverEarning || (order.deliveryFee || 0);
        
        return {
          orderId: order._id,
          orderDate: order.createdAt,
          customerName: order.user?.name || "N/A",
          orderValue: orderAmount,
          deliveryFee: order.deliveryFee || 0,
          commission,
          driverEarning,
          status: order.status
        };
      });

      const totalOrderValue = orderDetails.reduce((sum, o) => sum + o.orderValue, 0);
      const totalCommission = orderDetails.reduce((sum, o) => sum + o.commission, 0);
      const totalDriverEarnings = orderDetails.reduce((sum, o) => sum + o.driverEarning, 0);

      res.json({
        driver: {
          _id: driver._id,
          name: driver.name,
          phone: driver.phone,
          walletBalance: driver.walletBalance,
          totalEarnings: driver.totalEarnings,
          pendingWithdrawal: driver.pendingWithdrawal
        },
        orders: orderDetails,
        summary: {
          totalOrders: orders.length,
          totalOrderValue,
          totalCommission,
          totalDriverEarnings,
          commissionRate: COMMISSION_RATE,
          averagePerOrder: orders.length > 0 ? totalDriverEarnings / orders.length : 0
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// PAYOUT MANAGEMENT
// ============================================

// Get all payouts
router.get(
  "/payouts",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { status } = req.query;
      
      // Get all drivers with their pending withdrawals
      const drivers = await Driver.find({
        "withdrawalRequests.0": { $exists: true }
      });

      const allWithdrawals = [];
      drivers.forEach(driver => {
        driver.withdrawalRequests.forEach(request => {
          if (!status || request.status === status) {
            allWithdrawals.push({
              _id: request._id,
              driverId: driver._id,
              driverName: driver.name,
              driverPhone: driver.phone,
              amount: request.amount,
              status: request.status,
              requestedAt: request.requestedAt,
              processedAt: request.processedAt,
              bankAccount: request.bankAccount,
              upiId: request.upiId
            });
          }
        });
      });

      // Sort by date (newest first)
      allWithdrawals.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

      // Calculate totals
      const pending = allWithdrawals.filter(w => w.status === "pending");
      const approved = allWithdrawals.filter(w => w.status === "approved");
      const rejected = allWithdrawals.filter(w => w.status === "rejected");

      const totalPending = pending.reduce((sum, w) => sum + w.amount, 0);
      const totalApproved = approved.reduce((sum, w) => sum + w.amount, 0);
      const totalRejected = rejected.reduce((sum, w) => sum + w.amount, 0);

      res.json({
        withdrawals: allWithdrawals,
        summary: {
          total: allWithdrawals.length,
          pending: pending.length,
          approved: approved.length,
          rejected: rejected.length,
          totalPendingAmount: totalPending,
          totalApprovedAmount: totalApproved,
          totalRejectedAmount: totalRejected
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// WITHDRAWAL APPROVAL SYSTEM
// ============================================

// Approve withdrawal request
router.post(
  "/withdrawals/:driverId/:withdrawalId/approve",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { driverId, withdrawalId } = req.params;

      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const withdrawal = driver.withdrawalRequests.id(withdrawalId);
      if (!withdrawal) {
        return res.status(404).json({ message: "Withdrawal request not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ message: "Withdrawal request is not pending" });
      }

      if (driver.walletBalance < withdrawal.amount) {
        return res.status(400).json({ message: "Insufficient wallet balance" });
      }

      // Process the withdrawal
      driver.walletBalance -= withdrawal.amount;
      driver.pendingWithdrawal -= withdrawal.amount;
      withdrawal.status = "approved";
      withdrawal.processedAt = new Date();

      // Add to earnings history
      driver.earningsHistory.push({
        date: new Date(),
        amount: -withdrawal.amount,
        type: "withdrawal",
        description: `Withdrawal approved - ${withdrawal.bankAccount || withdrawal.upiId || "Bank transfer"}`
      });

      await driver.save();

      res.json({
        message: "Withdrawal approved successfully",
        withdrawal,
        remainingBalance: driver.walletBalance
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Reject withdrawal request
router.post(
  "/withdrawals/:driverId/:withdrawalId/reject",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { driverId, withdrawalId } = req.params;
      const { reason } = req.body;

      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const withdrawal = driver.withdrawalRequests.id(withdrawalId);
      if (!withdrawal) {
        return res.status(404).json({ message: "Withdrawal request not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ message: "Withdrawal request is not pending" });
      }

      // Reject the withdrawal
      withdrawal.status = "rejected";
      withdrawal.processedAt = new Date();

      // Add to earnings history
      driver.earningsHistory.push({
        date: new Date(),
        amount: 0,
        type: "withdrawal",
        description: `Withdrawal rejected: ${reason || "No reason provided"}`
      });

      await driver.save();

      res.json({
        message: "Withdrawal rejected",
        withdrawal
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// EXPORT REPORTS (CSV)
// ============================================

// Export revenue report as CSV
router.get(
  "/export/revenue",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      }

      const orders = await Order.find({
        status: "delivered",
        paymentStatus: "paid",
        ...dateFilter
      }).populate("user", "name email").populate("driver", "name");

      // Create CSV content
      const headers = [
        "Order ID",
        "Date",
        "Customer Name",
        "Customer Email",
        "Driver",
        "Total Price",
        "Delivery Fee",
        "Driver Earning",
        "Commission",
        "Payment Status",
        "Payment Method"
      ].join(",");

      const rows = orders.map(order => {
        const orderAmount = order.totalPrice - (order.deliveryFee || 0);
        const commission = orderAmount * (COMMISSION_RATE / 100);
        
        return [
          order._id,
          new Date(order.createdAt).toISOString(),
          order.user?.name || "",
          order.user?.email || "",
          order.driver?.name || "",
          order.totalPrice.toFixed(2),
          (order.deliveryFee || 0).toFixed(2),
          (order.driverEarning || 0).toFixed(2),
          commission.toFixed(2),
          order.paymentStatus,
          order.paymentMethod || ""
        ].join(",");
      });

      const csv = [headers, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=revenue_report_${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Export driver commissions as CSV
router.get(
  "/export/commissions",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      }

      const orders = await Order.find({
        status: "delivered",
        driver: { $exists: true, $ne: null },
        ...dateFilter
      }).populate("driver", "name phone");

      // Create CSV content
      const headers = [
        "Order ID",
        "Date",
        "Driver Name",
        "Driver Phone",
        "Order Value",
        "Delivery Fee",
        "Driver Earning",
        "Commission"
      ].join(",");

      const rows = orders.map(order => {
        const orderAmount = order.totalPrice - (order.deliveryFee || 0);
        const commission = orderAmount * (COMMISSION_RATE / 100);
        
        return [
          order._id,
          new Date(order.createdAt).toISOString(),
          order.driver?.name || "",
          order.driver?.phone || "",
          orderAmount.toFixed(2),
          (order.deliveryFee || 0).toFixed(2),
          (order.driverEarning || 0).toFixed(2),
          commission.toFixed(2)
        ].join(",");
      });

      const csv = [headers, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=driver_commissions_${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Export payouts as CSV
router.get(
  "/export/payouts",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { status } = req.query;
      
      const drivers = await Driver.find({
        "withdrawalRequests.0": { $exists: true }
      });

      const allWithdrawals = [];
      drivers.forEach(driver => {
        driver.withdrawalRequests.forEach(request => {
          if (!status || request.status === status) {
            allWithdrawals.push({
              driverName: driver.name,
              driverPhone: driver.phone,
              amount: request.amount,
              status: request.status,
              requestedAt: request.requestedAt,
              processedAt: request.processedAt,
              bankAccount: request.bankAccount,
              upiId: request.upiId
            });
          }
        });
      });

      // Create CSV content
      const headers = [
        "Driver Name",
        "Phone",
        "Amount",
        "Status",
        "Requested Date",
        "Processed Date",
        "Bank Account",
        "UPI ID"
      ].join(",");

      const rows = allWithdrawals.map(w => [
        w.driverName,
        w.driverPhone,
        w.amount.toFixed(2),
        w.status,
        w.requestedAt ? new Date(w.requestedAt).toISOString() : "",
        w.processedAt ? new Date(w.processedAt).toISOString() : "",
        w.bankAccount || "",
        w.upiId || ""
      ].join(","));

      const csv = [headers, ...rows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=payouts_${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// GST REPORTING MODULE
// ============================================

// Get GST report
router.get(
  "/gst",
  protect,
  adminOnly,
  [
    query("startDate").optional().isISO8601().withMessage("Invalid start date"),
    query("endDate").optional().isISO8601().withMessage("Invalid end date"),
    query("quarter").optional().isIn(["Q1", "Q2", "Q3", "Q4"]).withMessage("Invalid quarter")
  ],
  validate,
  async (req, res) => {
    try {
      const { startDate, endDate, quarter } = req.query;
      
      let dateFilter = {};
      const now = new Date();
      
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      } else if (quarter) {
        const year = now.getFullYear();
        const quarterMonths = {
          "Q1": [0, 2],
          "Q2": [3, 5],
          "Q3": [6, 8],
          "Q4": [9, 11]
        };
        const [startMonth, endMonth] = quarterMonths[quarter];
        dateFilter = {
          createdAt: {
            $gte: new Date(year, startMonth, 1),
            $lte: new Date(year, endMonth + 1, 0)
          }
        };
      } else {
        // Default: current month
        dateFilter = {
          createdAt: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0)
          }
        };
      }

      // Get completed payments
      const payments = await Payment.find({
        status: "completed",
        ...dateFilter
      }).populate("order");

      // Calculate GST
      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      
      // Assuming GST is included in the price, calculate base amount and GST
      // Base amount = Total / (1 + GST_RATE/100)
      // GST = Total - Base amount
      const baseAmount = totalAmount / (1 + GST_RATE / 100);
      const totalGST = totalAmount - baseAmount;
      
      // CGST (50% of total GST)
      const cgst = totalGST / 2;
      
      // SGST (50% of total GST)
      const sgst = totalGST / 2;

      // IGST (for inter-state, assuming 0 for now)
      const igst = 0;

      // Revenue by tax type
      const taxSummary = {
        totalAmount,
        baseAmount,
        totalGST,
        cgst,
        sgst,
        igst,
        gstRate: GST_RATE
      };

      // Monthly breakdown
      const monthlyGST = {};
      payments.forEach(payment => {
        const month = new Date(payment.createdAt).toISOString().slice(0, 7);
        const paymentAmount = payment.amount;
        const paymentBase = paymentAmount / (1 + GST_RATE / 100);
        const paymentGST = paymentAmount - paymentBase;
        
        if (!monthlyGST[month]) {
          monthlyGST[month] = {
            totalAmount: 0,
            baseAmount: 0,
            gst: 0,
            invoiceCount: 0
          };
        }
        
        monthlyGST[month].totalAmount += paymentAmount;
        monthlyGST[month].baseAmount += paymentBase;
        monthlyGST[month].gst += paymentGST;
        monthlyGST[month].invoiceCount += 1;
      });

      // Invoice details
      const invoices = payments.map(payment => ({
        invoiceNumber: payment.transactionId,
        date: payment.createdAt,
        amount: payment.amount,
        baseAmount: payment.amount / (1 + GST_RATE / 100),
        gstAmount: payment.amount - (payment.amount / (1 + GST_RATE / 100)),
        paymentMethod: payment.paymentMethod,
        status: payment.status
      }));

      res.json({
        summary: taxSummary,
        monthlyGST,
        invoices,
        dateRange: {
          start: startDate || null,
          end: endDate || null,
          quarter: quarter || null
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Export GST report as CSV
router.get(
  "/export/gst",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter = {
          createdAt: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        };
      } else {
        const now = new Date();
        dateFilter = {
          createdAt: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0)
          }
        };
      }

      const payments = await Payment.find({
        status: "completed",
        ...dateFilter
      });

      // Create CSV content
      const headers = [
        "Invoice Number",
        "Date",
        "Total Amount",
        "Base Amount",
        "CGST",
        "SGST",
        "IGST",
        "Total GST",
        "Payment Method"
      ].join(",");

      const rows = payments.map(payment => {
        const baseAmount = payment.amount / (1 + GST_RATE / 100);
        const gstAmount = payment.amount - baseAmount;
        const cgstAmount = gstAmount / 2;
        const sgstAmount = gstAmount / 2;
        
        return [
          payment.transactionId,
          new Date(payment.createdAt).toISOString(),
          payment.amount.toFixed(2),
          baseAmount.toFixed(2),
          cgstAmount.toFixed(2),
          sgstAmount.toFixed(2),
          "0.00",
          gstAmount.toFixed(2),
          payment.paymentMethod
        ].join(",");
      });

      // Add summary rows at the end
      const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      const totalBaseAmount = totalAmount / (1 + GST_RATE / 100);
      const totalGSTAmount = totalAmount - totalBaseAmount;
      
      const summaryRows = [
        "",
        "SUMMARY",
        `Total Amount,${totalAmount.toFixed(2)}`,
        `Base Amount,${totalBaseAmount.toFixed(2)}`,
        `Total CGST,${(totalGSTAmount / 2).toFixed(2)}`,
        `Total SGST,${(totalGSTAmount / 2).toFixed(2)}`,
        `Total GST,${totalGSTAmount.toFixed(2)}`,
        `GST Rate,${GST_RATE}%`
      ];

      const csv = [headers, ...rows, ...summaryRows].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=gst_report_${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// DASHBOARD SUMMARY
// ============================================

// Get financial dashboard summary
router.get(
  "/dashboard",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

      // Current month stats
      const currentMonthOrders = await Order.find({
        status: "delivered",
        paymentStatus: "paid",
        createdAt: { $gte: startOfMonth }
      });

      const currentMonthRevenue = currentMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0);
      const currentMonthOrdersCount = currentMonthOrders.length;

      // Last month stats
      const lastMonthOrders = await Order.find({
        status: "delivered",
        paymentStatus: "paid",
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }
      });

      const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0);
      const lastMonthOrdersCount = lastMonthOrders.length;

      // Calculate growth
      const revenueGrowth = lastMonthRevenue > 0 
        ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100 
        : 0;
      const ordersGrowth = lastMonthOrdersCount > 0 
        ? ((currentMonthOrdersCount - lastMonthOrdersCount) / lastMonthOrdersCount) * 100 
        : 0;

      // Platform commission this month
      const currentMonthCommission = currentMonthOrders.reduce((sum, order) => {
        const orderAmount = order.totalPrice - (order.deliveryFee || 0);
        return sum + (orderAmount * COMMISSION_RATE / 100);
      }, 0);

      // Pending driver withdrawals
      const drivers = await Driver.find({ "withdrawalRequests.0": { $exists: true } });
      let pendingWithdrawals = 0;
      drivers.forEach(driver => {
        driver.withdrawalRequests.forEach(req => {
          if (req.status === "pending") {
            pendingWithdrawals += req.amount;
          }
        });
      });

      // Total driver earnings this month
      const driverEarnings = currentMonthOrders.reduce((sum, o) => sum + (o.driverEarning || 0), 0);

      res.json({
        revenue: {
          currentMonth: currentMonthRevenue,
          lastMonth: lastMonthRevenue,
          growth: revenueGrowth
        },
        orders: {
          currentMonth: currentMonthOrdersCount,
          lastMonth: lastMonthOrdersCount,
          growth: ordersGrowth
        },
        commission: {
          currentMonth: currentMonthCommission,
          rate: COMMISSION_RATE
        },
        driverEarnings: {
          currentMonth: driverEarnings
        },
        pendingWithdrawals,
        averageOrderValue: currentMonthOrdersCount > 0 
          ? currentMonthRevenue / currentMonthOrdersCount 
          : 0
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
