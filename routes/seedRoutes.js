const express = require("express");
const bcrypt = require("bcryptjs");
const Restaurant = require("../models/Restaurant");
const MenuItem = require("../models/MenuItem");
const Order = require("../models/Order");
const User = require("../models/User");
const Driver = require("../models/Driver");
const Banner = require("../models/Banner");
const Offer = require("../models/Offer");

const router = express.Router();

router.post("/", async (_req, res) => {
  try {
    // Only create demo driver - skip restaurant and menu seeding
    // Restaurants and menu items should be added through admin interface

    // Create demo driver user and driver profile
    let driverUser = await User.findOne({ email: "driver@test.com" });
    if (!driverUser) {
      const hashedPassword = await bcrypt.hash("driver123", 10);
      driverUser = await User.create({
        name: "Demo Driver",
        email: "driver@test.com",
        password: hashedPassword,
        role: "customer"
      });
    }

    // Check if driver profile already exists
    let driver = await Driver.findOne({ email: "driver@test.com" });
    if (!driver) {
      driver = await Driver.create({
        name: "Demo Driver",
        email: "driver@test.com",
        phone: "+1234567890",
        vehicleType: "bike",
        vehicleNumber: "ABC 123",
        licenseNumber: "DL123456789",
        status: "available",
        isVerified: true,
        user: driverUser._id,
        rating: 4.8,
        totalDeliveries: 0
      });
    }

    return res.status(201).json({ 
      message: force ? "Reseeded successfully" : "Seeded successfully",
      demoDriver: {
        email: "driver@test.com",
        password: "driver123"
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Seed sample orders for testing
router.post("/orders", async (_req, res) => {
  try {
    // Get menu items
    const menuItemsData = await MenuItem.find().limit(5);
    if (menuItemsData.length === 0) {
      return res.status(400).json({ message: "No menu items found. Please seed menu first." });
    }

    // Get or create a test user
    let testUser = await User.findOne({ email: "test@example.com" });
    if (!testUser) {
      const hashedPassword = await bcrypt.hash("password123", 10);
      testUser = await User.create({
        name: "Test User",
        email: "test@example.com",
        password: hashedPassword
      });
    }

    // Get or create demo driver
    let driverUser = await User.findOne({ email: "driver@test.com" });
    let driver = null;
    if (driverUser) {
      driver = await Driver.findOne({ user: driverUser._id });
    }

    // Check if orders already exist
    const existingOrders = await Order.countDocuments();
    if (existingOrders > 0) {
      return res.json({ message: "Orders already exist", count: existingOrders });
    }

    // Create sample orders - with driver assigned if driver exists
    const sampleOrders = [
      {
        user: testUser._id,
        items: [
          { menuItem: menuItemsData[0]._id, name: menuItemsData[0].name, price: menuItemsData[0].price, quantity: 2, unit: menuItemsData[0].unit }
        ],
        totalPrice: menuItemsData[0].price * 2,
        status: "assigned",
        paymentStatus: "paid",
        address: "123 Main Street, City",
        driver: driver ? driver._id : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        deliveryFee: 30,
        driverEarning: 24
      },
      {
        user: testUser._id,
        items: [
          { menuItem: menuItemsData[1]._id, name: menuItemsData[1].name, price: menuItemsData[1].price, quantity: 1, unit: menuItemsData[1].unit },
          { menuItem: menuItemsData[2]._id, name: menuItemsData[2].name, price: menuItemsData[2].price, quantity: 1, unit: menuItemsData[2].unit }
        ],
        totalPrice: menuItemsData[1].price + menuItemsData[2].price,
        status: "accepted",
        paymentStatus: "paid",
        address: "456 Oak Avenue, Town",
        driver: driver ? driver._id : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        deliveryFee: 30,
        driverEarning: 24,
        assignedAt: new Date(),
        acceptedAt: new Date()
      },
      {
        user: testUser._id,
        items: [
          { menuItem: menuItemsData[3]._id, name: menuItemsData[3].name, price: menuItemsData[3].price, quantity: 3, unit: menuItemsData[3].unit }
        ],
        totalPrice: menuItemsData[3].price * 3,
        status: "out_for_delivery",
        paymentStatus: "paid",
        address: "789 Pine Road, Village",
        estimatedDeliveryTime: "25-30 min",
        driver: driver ? driver._id : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        deliveryFee: 30,
        driverEarning: 24,
        assignedAt: new Date(),
        acceptedAt: new Date(),
        pickedAt: new Date()
      },
      {
        user: testUser._id,
        items: [
          { menuItem: menuItemsData[4]._id, name: menuItemsData[4].name, price: menuItemsData[4].price, quantity: 2, unit: menuItemsData[4].unit }
        ],
        totalPrice: menuItemsData[4].price * 2,
        status: "delivered",
        paymentStatus: "paid",
        address: "321 Elm Street, City",
        deliveredAt: new Date(),
        driver: driver ? driver._id : null,
        driverName: driver ? driver.name : null,
        driverPhone: driver ? driver.phone : null,
        deliveryFee: 30,
        driverEarning: 24,
        assignedAt: new Date(Date.now() - 3600000),
        acceptedAt: new Date(Date.now() - 3600000),
        pickedAt: new Date(Date.now() - 1800000)
      }
    ];

    await Order.insertMany(sampleOrders);
    
    // Update driver status if driver exists
    if (driver) {
      driver.status = "busy";
      await driver.save();
    }
    
    return res.status(201).json({ message: "Sample orders created successfully", count: sampleOrders.length });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});
        
// Assign existing orders to demo driver for testing
router.post("/assign-orders-to-driver", async (_req, res) => {
  try {
    // Get demo driver
    let driverUser = await User.findOne({ email: "driver@test.com" });
    if (!driverUser) {
      return res.status(404).json({ message: "Demo driver not found. Please run main seed first." });
    }
    
    let driver = await Driver.findOne({ user: driverUser._id });
    if (!driver) {
      return res.status(404).json({ message: "Demo driver profile not found." });
    }

    // Get orders without driver assigned
    const ordersWithoutDriver = await Order.find({ 
      $or: [
        { driver: { $exists: false } },
        { driver: null }
      ]
    });

    if (ordersWithoutDriver.length === 0) {
      return res.json({ message: "No unassigned orders found" });
    }

    // Update orders to assign to driver
    const deliveryFee = 30;
    const driverEarning = Math.round(deliveryFee * 0.8 * 100) / 100;
    
    for (let order of ordersWithoutDriver) {
      order.driver = driver._id;
      order.driverName = driver.name;
      order.driverPhone = driver.phone;
      order.deliveryFee = deliveryFee;
      order.driverEarning = driverEarning;
      
      // Set appropriate status based on current status
      if (order.status === "pending") {
        order.status = "assigned";
        order.assignedAt = new Date();
      } else if (order.status === "confirmed") {
        order.status = "accepted";
        order.assignedAt = new Date();
        order.acceptedAt = new Date();
      }
      
      await order.save();
    }

    // Update driver status
    driver.status = "busy";
    await driver.save();

    return res.json({ 
      message: `Assigned ${ordersWithoutDriver.length} orders to driver successfully`,
      ordersAssigned: ordersWithoutDriver.length
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Seed sample banners for testing
router.post("/banners", async (_req, res) => {
  try {
    // Check if banners already exist
    const existingBanners = await Banner.countDocuments();
    if (existingBanners > 0) {
      return res.json({ message: "Banners already exist", count: existingBanners });
    }

    // Create sample banners for food delivery
    const sampleBanners = [
      {
        title: "Welcome to FoodieHub!",
        description: "Discover amazing restaurants and delicious meals delivered to your doorstep.",
        image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
        link: "",
        linkType: "none",
        category: "",
        position: 1,
        isActive: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
      },
      {
        title: "Free Delivery on Orders Above ₹500",
        description: "Order now and enjoy free delivery on all orders above ₹500!",
        image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
        link: "/menu",
        linkType: "menu",
        category: "",
        position: 2,
        isActive: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15 days from now
      },
      {
        title: "Try Our New Pizza Collection",
        description: "Fresh, hot pizzas made with premium ingredients. Order now!",
        image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80",
        link: "pizza",
        linkType: "category",
        category: "Pizza",
        position: 3,
        isActive: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) // 20 days from now
      },
      {
        title: "Weekend Special: 20% Off on Burgers",
        description: "Enjoy our juicy burgers with 20% discount this weekend only!",
        image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80",
        link: "burgers",
        linkType: "category",
        category: "Burgers",
        position: 4,
        isActive: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
      },
      {
        title: "Healthy Eating Made Easy",
        description: "Explore our range of healthy salads and fresh juices.",
        image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80",
        link: "salads",
        linkType: "category",
        category: "Salads",
        position: 5,
        isActive: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000) // 25 days from now
      }
    ];

    await Banner.insertMany(sampleBanners);

    return res.status(201).json({
      message: "Sample banners created successfully",
      count: sampleBanners.length,
      banners: sampleBanners.map(b => ({ title: b.title, position: b.position, isActive: b.isActive }))
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Seed sample offers and coupons for testing
router.post("/offers", async (_req, res) => {
  try {
    // Check if offers already exist
    const existingOffers = await Offer.countDocuments();
    if (existingOffers > 0) {
      return res.json({ message: "Offers already exist", count: existingOffers });
    }

    // Create sample offers and coupons
    const sampleOffers = [
      {
        code: "WELCOME10",
        name: "Welcome Discount",
        description: "10% off on your first order",
        discountType: "percentage",
        discountValue: 10,
        minOrderValue: 200,
        maxDiscountValue: 50,
        usageLimit: 1000,
        userUsageLimit: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        isActive: true,
        isPublic: true
      },
      {
        code: "PIZZA20",
        name: "Pizza Special",
        description: "20% off on all pizzas",
        discountType: "percentage",
        discountValue: 20,
        minOrderValue: 300,
        maxDiscountValue: 100,
        applicableCategories: ["Pizza"],
        usageLimit: 500,
        userUsageLimit: 3,
        startDate: new Date(),
        endDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        isActive: true,
        isPublic: true
      },
      {
        code: "BURGER50",
        name: "Burger Deal",
        description: "₹50 off on burgers above ₹400",
        discountType: "fixed",
        discountValue: 50,
        minOrderValue: 400,
        applicableCategories: ["Burgers"],
        usageLimit: 200,
        userUsageLimit: 2,
        startDate: new Date(),
        endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days from now
        isActive: true,
        isPublic: true
      },
      {
        code: "FLASH30",
        name: "Flash Sale",
        description: "30% off on orders above ₹500 (limited time)",
        discountType: "percentage",
        discountValue: 30,
        minOrderValue: 500,
        maxDiscountValue: 150,
        usageLimit: 100,
        userUsageLimit: 1,
        startDate: new Date(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        isActive: true,
        isPublic: true
      },
      {
        code: "LOYALTY15",
        name: "Loyalty Reward",
        description: "15% off for returning customers",
        discountType: "percentage",
        discountValue: 15,
        minOrderValue: 250,
        maxDiscountValue: 75,
        usageLimit: null, // unlimited
        userUsageLimit: 5,
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
        isActive: true,
        isPublic: false // requires special access
      }
    ];

    await Offer.insertMany(sampleOffers);

    return res.status(201).json({
      message: "Sample offers and coupons created successfully",
      count: sampleOffers.length,
      offers: sampleOffers.map(o => ({ code: o.code, name: o.name, discountType: o.discountType, discountValue: o.discountValue, isActive: o.isActive }))
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;


