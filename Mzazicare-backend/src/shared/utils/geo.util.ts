import type { GeoPoint } from "@/shared/types";

const EARTH_RADIUS_M = 6_371_000;

export const toGeoPoint = (latitude: number, longitude: number): GeoPoint => ({
  type: "Point",
  coordinates: [longitude, latitude],
});

/** Great-circle distance in metres — visit-service uses it to verify check-in. */
export const distanceMeters = (a: GeoPoint, b: GeoPoint): number => {
  const [lon1, lat1] = a.coordinates;
  const [lon2, lat2] = b.coordinates;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};

export const isWithinRadius = (point: GeoPoint, centre: GeoPoint, radiusMeters: number): boolean =>
  distanceMeters(point, centre) <= radiusMeters;
