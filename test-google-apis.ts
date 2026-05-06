import dotenv from "dotenv";
import path from "path";

// Load .env from the current directory
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const SERPER_KEY = process.env.SERPER_API_KEY || "";

async function testPlacesApi() {
  console.log("\n--- Testing Google Places API (New) ---");
  if (!MAPS_KEY) {
    console.error("❌ GOOGLE_MAPS_API_KEY is missing in .env");
    return;
  }

  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = { textQuery: "Baguio City" };
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": MAPS_KEY,
    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress"
  };

  try {
    console.log(`Fetching: ${url} (Key ending in ...${MAPS_KEY.slice(-4)})`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (response.ok) {
      console.log("✅ Places API Success!");
      console.log("Result:", JSON.stringify(data, null, 2));
    } else {
      console.error(`❌ Places API Failed (HTTP ${response.status})`);
      console.error("Error Detail:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("❌ Request failed:", error);
  }
}

async function testSerperApi() {
  console.log("\n--- Testing Serper.dev API ---");
  if (!SERPER_KEY) {
    console.error("❌ SERPER_API_KEY is missing in .env");
    return;
  }

  const url = "https://google.serper.dev/search";
  const body = { q: "Baguio City weather" };
  const headers = {
    "X-API-KEY": SERPER_KEY,
    "Content-Type": "application/json"
  };

  try {
    console.log(`Fetching: ${url} (Key ending in ...${SERPER_KEY.slice(-4)})`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (response.ok) {
      console.log("✅ Serper.dev API Success!");
      console.log(`Found ${data.organic?.length || 0} organic results.`);
      if (data.organic?.[0]) {
        console.log("First Result:", data.organic[0].title);
      }
    } else {
      console.error(`❌ Serper.dev API Failed (HTTP ${response.status})`);
      console.error("Error Detail:", JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error("❌ Request failed:", error);
  }
}

async function runTests() {
  console.log("Starting API Connectivity Tests...");
  await testPlacesApi();
  await testSerperApi();
  console.log("\nTests Complete.");
}

runTests();
