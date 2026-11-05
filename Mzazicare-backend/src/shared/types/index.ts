export type Role = "family" | "elder" | "caregiver" | "coordinator" | "admin" | "auditor";

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** GeoJSON. Order is [longitude, latitude] — the commonest bug in visit-service. */
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface AuthUser {
  id: string;
  role: Role;
}
