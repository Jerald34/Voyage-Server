export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type PlaceSearchResult = {
  id: string;
  name: string;
  address?: string;
  location?: GeoPoint;
  rating?: number;
  userRatingCount?: number;
  types: string[];
};

export type PlaceDetailsResult = PlaceSearchResult & {
  phoneNumber?: string;
  websiteUri?: string;
  /** Photo references returned when `photos` is included in the field mask. */
  photos?: Array<{ name: string; photoUri: string }>;
};

export type ResolvedPlace = {
  provider: "GOOGLE_MAPS" | "NOMINATIM";
  providerPlaceId: string;
  name: string;
  formattedAddress?: string;
  location: GeoPoint;
  rating?: number;
  websiteUrl?: string;
  phoneNumber?: string;
  metadata?: Record<string, unknown>;
};

export type RouteEstimateResult = {
  distanceMeters?: number;
  durationSeconds?: number;
  staticDurationSeconds?: number;
  polyline?: string;
};

export type MapsProvider = {
  resolvePlace(input: {
    placeName: string;
    cityContext?: string;
    countryCode?: string;
    languageCode?: string;
    locationBias?: GeoPoint;
  }): Promise<ResolvedPlace>;
  searchPlaces(input: { query: string; languageCode?: string; maxResultCount?: number }): Promise<PlaceSearchResult[]>;
  searchNearby(input: {
    location: GeoPoint;
    radius: number;
    includedTypes?: string[];
    maxResultCount?: number;
    languageCode?: string;
  }): Promise<PlaceSearchResult[]>;
  getPlaceDetails(placeId: string): Promise<PlaceDetailsResult>;
  getPlacePhotos(placeId: string, maxResults?: number): Promise<{ name: string; photoUri: string }[]>;
  /**
   * Fetch a place photo by resource name, authenticating server-side with the
   * API key in a request header. The key never appears in any URL or persisted data.
   * Returns the raw image bytes and content-type for buffer-based Cloudinary upload.
   */
  fetchPlacePhoto(
    photoName: string,
    dimensions: { width: number; height: number }
  ): Promise<{ bytes: Buffer; contentType: string }>;
  estimateRoute(input: {
    origin: GeoPoint;
    destination: GeoPoint;
    travelMode?: "DRIVE" | "BICYCLE" | "WALK" | "TWO_WHEELER" | "TRANSIT";
    routingPreference?: "TRAFFIC_UNAWARE" | "TRAFFIC_AWARE" | "TRAFFIC_AWARE_OPTIMAL";
  }): Promise<RouteEstimateResult>;
};
