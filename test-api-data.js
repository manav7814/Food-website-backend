require("dotenv").config({ path: __dirname + "/.env" });
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

async function testAPI() {
  try {
    console.log("Testing MongoDB Connection...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected Successfully!\n");

    const db = mongoose.connection.db;
    
    // Test Menu Items
    const menuItems = await db.collection("menuitems").find({}).toArray();
    console.log(`✅ Menu Items: ${menuItems.length} found`);
    
    // Test Restaurants
    const restaurants = await db.collection("restaurants").find({}).toArray();
    console.log(`✅ Restaurants: ${restaurants.length} found`);
    
    // Test Users
    const users = await db.collection("users").find({}).toArray();
    console.log(`✅ Users: ${users.length} found`);
    
    // Test Orders
    const orders = await db.collection("orders").find({}).toArray();
    console.log(`✅ Orders: ${orders.length} found`);
    
    console.log("\n✅ All data is accessible from MongoDB!");
    console.log("The backend is connected to the correct database.");
    
    if (menuItems.length > 0) {
      console.log("\n📋 Sample Menu Item:");
      console.log(JSON.stringify(menuItems[0], null, 2));
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoose.disconnect();
  }
}

testAPI();
