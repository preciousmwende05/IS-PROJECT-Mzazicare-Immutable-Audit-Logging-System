/**
 * Kenyan reference data used across the UI.
 *
 * The API requires a home location (latitude/longitude) for every elder. When
 * the family does not share their device location, we use the county town's
 * coordinates so a visit can still be planned.
 */

export type County = { name: string; town: string; latitude: number; longitude: number };

export const COUNTIES: County[] = [
  { name: "Nairobi", town: "Nairobi", latitude: -1.2864, longitude: 36.8172 },
  { name: "Mombasa", town: "Mombasa", latitude: -4.0435, longitude: 39.6682 },
  { name: "Kisumu", town: "Kisumu", latitude: -0.0917, longitude: 34.768 },
  { name: "Nakuru", town: "Nakuru", latitude: -0.3031, longitude: 36.08 },
  { name: "Kiambu", town: "Kiambu", latitude: -1.1714, longitude: 36.8356 },
  { name: "Machakos", town: "Machakos", latitude: -1.5177, longitude: 37.2634 },
  { name: "Kajiado", town: "Kajiado", latitude: -1.8524, longitude: 36.7768 },
  { name: "Uasin Gishu", town: "Eldoret", latitude: 0.5143, longitude: 35.2698 },
  { name: "Nyeri", town: "Nyeri", latitude: -0.4201, longitude: 36.9476 },
  { name: "Murang'a", town: "Murang'a", latitude: -0.7839, longitude: 37.04 },
  { name: "Kakamega", town: "Kakamega", latitude: 0.2827, longitude: 34.7519 },
  { name: "Kilifi", town: "Kilifi", latitude: -3.6305, longitude: 39.8499 },
  { name: "Meru", town: "Meru", latitude: 0.0463, longitude: 37.6559 },
  { name: "Embu", town: "Embu", latitude: -0.5389, longitude: 37.4596 },
  { name: "Kericho", town: "Kericho", latitude: -0.3677, longitude: 35.2831 },
  { name: "Kisii", town: "Kisii", latitude: -0.6817, longitude: 34.7667 },
  { name: "Bungoma", town: "Bungoma", latitude: 0.5635, longitude: 34.5606 },
  { name: "Nyandarua", town: "Ol Kalou", latitude: -0.27, longitude: 36.38 },
  { name: "Laikipia", town: "Nanyuki", latitude: 0.0167, longitude: 37.0667 },
  { name: "Kirinyaga", town: "Kerugoya", latitude: -0.4989, longitude: 37.2803 },
];

export const countyByName = (name?: string | null) => COUNTIES.find((c) => c.name === name);

export const SUPPORT_LINE = "0800 720 600";
export const EMERGENCY_NUMBERS = "999 or 112";

/** "+254 712 345 678" from "+254712345678". */
export const formatPhone = (phone?: string | null): string => {
  if (!phone) return "";
  const m = phone.match(/^\+254(\d{3})(\d{3})(\d{3})$/);
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : phone;
};
