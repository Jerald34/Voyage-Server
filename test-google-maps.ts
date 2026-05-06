import dotenv from "dotenv";
import path from "path";
import { createGoogleMapsProvider } from "./src/services/maps";

// Load .env from the current directory
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

async function runMapsTests() {
  console.log("Starting Comprehensive Google Maps API Tests...\n");

  if (!MAPS_KEY) {
    console.error("❌ GOOGLE_MAPS_API_KEY is missing in .env");
    return;
  }

  const maps = createGoogleMapsProvider({ apiKey: MAPS_KEY });

  // 1. Test Text Search (Used by search_google_places, map_pinpoint)
  try {
    console.log("--- 1. Testing Place Text Search ---");
    const results = await maps.searchPlaces({ query: "Burnham Park Baguio" });
    if (results.length > 0) {
      console.log(`✅ Success: Found ${results.length} places. Top result: ${results[0].name}`);
      
      // 2. Test Place Details (Used by get_google_place_details)
      const placeId = results[0].id;
      console.log("\n--- 2. Testing Place Details ---");
      const details = await maps.getPlaceDetails(placeId);
      console.log(`✅ Success: Retrieved details for ${details.name}`);

      // 3. Test Place Photos (Used by get_google_place_photos)
      console.log("\n--- 3. Testing Place Photos ---");
      const photos = await maps.getPlacePhotos(placeId, 1);
      if (photos.length > 0) {
        console.log(`✅ Success: Photo link retrieved: ${photos[0].photoUri.slice(0, 50)}...`);
      } else {
        console.log("ℹ️ No photos found for this place.");
      }
    }
  } catch (error: any) {
    console.error("❌ Places Test Failed:", error?.message || error);
  }

  // 4. Test Nearby Search (Used by search_nearby_google_places)
  try {
    console.log("\n--- 4. Testing Nearby Search ---");
    const nearby = await maps.searchNearby({
      location: { latitude: 16.4123, longitude: 120.5933 }, // Baguio center
      radius: 1000,
      includedTypes: ["restaurant"]
    });
    console.log(`✅ Success: Found ${nearby.length} restaurants nearby.`);
  } catch (error: any) {
    console.error("❌ Nearby Search Failed:", error?.message || error);
  }

  // 5. Test Routing (Used by estimate_route, route_logistics)
  try {
    console.log("\n--- 5. Testing Routes/Directions ---");
    const route = await maps.estimateRoute({
      origin: { latitude: 16.4123, longitude: 120.5933 }, // Burnham Park
      destination: { latitude: 16.4189, longitude: 120.5971 } // SM Baguio
    });
    console.log(`✅ Success: Route calculated.`);
    console.log(`   Distance: ${route.distanceMeters}m`);
    console.log(`   Duration: ${route.durationSeconds}s`);
  } catch (error: any) {
    console.error("❌ Routing Test Failed:", error?.message || error);
  }

  console.log("\n--- Tests Complete ---");
}

runMapsTests();
