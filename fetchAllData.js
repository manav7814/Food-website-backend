require("dotenv").config({ path: __dirname + "/.env" });
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

async function fetchAllData() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB successfully!\n");

    const db = mongoose.connection.db;
    
    // Get all collection names
    const collections = await db.listCollections().toArray();
    console.log("Found collections:", collections.map(c => c.name).join(", "));
    console.log("\n" + "=".repeat(50));
    console.log("FETCHING ALL DATA FROM FOODHUB DATABASE");
    console.log("=".repeat(50) + "\n");

    for (const collection of collections) {
      const collectionName = collection.name;
      const documents = await db.collection(collectionName).find({}).toArray();
      
      console.log(`\n📁 Collection: ${collectionName}`);
      console.log(`   Total documents: ${documents.length}`);
      console.log("-".repeat(40));
      
      if (documents.length > 0) {
        documents.forEach((doc, index) => {
          console.log(`\n   [${index + 1}] ${JSON.stringify(doc, null, 2)}`);
        });
      } else {
        console.log("   (No documents found)");
      }
      console.log("\n" + "-".repeat(40));
    }

    console.log("\n" + "=".repeat(50));
    console.log("DATA FETCH COMPLETE");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }
}

fetchAllData();
