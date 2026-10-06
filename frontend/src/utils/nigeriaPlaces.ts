// Nigerian places table + coordinate helpers, mirroring
// backend/app/services/nigeria_places.py so every screen labels a
// coordinate pair exactly the way the API's own formatter would.
// Embedded (no reverse-geocoding API): instant, offline, deterministic.

export interface NigeriaPlace {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

// 36 state capitals + FCT Abuja + Lagos/Ikeja (commercial hub).
export const NIGERIAN_PLACES: NigeriaPlace[] = [
  { name: "Abuja (FCT)", state: "FCT", lat: 9.0579, lon: 7.4951 },
  { name: "Lagos", state: "Lagos", lat: 6.5244, lon: 3.3792 },
  { name: "Ikeja", state: "Lagos", lat: 6.6018, lon: 3.3515 },
  { name: "Kano", state: "Kano", lat: 12.0022, lon: 8.592 },
  { name: "Ibadan", state: "Oyo", lat: 7.3775, lon: 3.947 },
  { name: "Port Harcourt", state: "Rivers", lat: 4.8156, lon: 7.0498 },
  { name: "Benin City", state: "Edo", lat: 6.335, lon: 5.6037 },
  { name: "Kaduna", state: "Kaduna", lat: 10.5105, lon: 7.4165 },
  { name: "Abeokuta", state: "Ogun", lat: 7.1475, lon: 3.3619 },
  { name: "Awka", state: "Anambra", lat: 6.2127, lon: 7.0726 },
  { name: "Umuahia", state: "Abia", lat: 5.495, lon: 7.495 },
  { name: "Maiduguri", state: "Borno", lat: 11.8333, lon: 13.15 },
  { name: "Bauchi", state: "Bauchi", lat: 10.3158, lon: 9.8443 },
  { name: "Akure", state: "Ondo", lat: 7.2467, lon: 5.2014 },
  { name: "Enugu", state: "Enugu", lat: 6.4584, lon: 7.5467 },
  { name: "Abakaliki", state: "Ebonyi", lat: 6.3284, lon: 8.111 },
  { name: "Calabar", state: "Cross River", lat: 4.8156, lon: 8.327 },
  { name: "Asaba", state: "Delta", lat: 6.1983, lon: 6.7333 },
  { name: "Damaturu", state: "Yobe", lat: 11.747, lon: 11.9658 },
  { name: "Dutse", state: "Jigawa", lat: 11.7564, lon: 9.3395 },
  { name: "Ado-Ekiti", state: "Ekiti", lat: 7.7189, lon: 5.3107 },
  { name: "Gombe", state: "Gombe", lat: 10.2897, lon: 11.1687 },
  { name: "Ilorin", state: "Kwara", lat: 8.4966, lon: 4.5421 },
  { name: "Jos", state: "Plateau", lat: 9.8965, lon: 8.8583 },
  { name: "Katsina", state: "Katsina", lat: 12.9908, lon: 7.6018 },
  { name: "Lokoja", state: "Kogi", lat: 7.8016, lon: 6.7456 },
  { name: "Makurdi", state: "Benue", lat: 7.73, lon: 8.51 },
  { name: "Minna", state: "Niger", lat: 9.6152, lon: 6.5478 },
  { name: "Yola", state: "Adamawa", lat: 9.261, lon: 12.474 },
  { name: "Osogbo", state: "Osun", lat: 7.7561, lon: 4.5667 },
  { name: "Owerri", state: "Imo", lat: 5.4833, lon: 7.05 },
  { name: "Sokoto", state: "Sokoto", lat: 13.0622, lon: 5.2339 },
  { name: "Uyo", state: "Akwa Ibom", lat: 5.039, lon: 7.943 },
  { name: "Yenagoa", state: "Bayelsa", lat: 4.9267, lon: 6.267 },
  { name: "Jalingo", state: "Taraba", lat: 8.8934, lon: 11.3622 },
  { name: "Lafia", state: "Nasarawa", lat: 8.4966, lon: 8.5167 },
  { name: "Gusau", state: "Zamfara", lat: 11.9239, lon: 6.689 },
  { name: "Birnin Kebbi", state: "Kebbi", lat: 12.4551, lon: 4.1967 },
];

const NG_LAT_MIN = 4.27;
const NG_LAT_MAX = 13.9;
const NG_LON_MIN = 2.67;
const NG_LON_MAX = 14.68;

export const isInNigeria = (
  lat: number | null | undefined,
  lon: number | null | undefined
): boolean =>
  lat !== null &&
  lat !== undefined &&
  lon !== null &&
  lon !== undefined &&
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  lat >= NG_LAT_MIN &&
  lat <= NG_LAT_MAX &&
  lon >= NG_LON_MIN &&
  lon <= NG_LON_MAX;

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};

export const nearestPlace = (lat: number, lon: number): NigeriaPlace =>
  NIGERIAN_PLACES.reduce((best, p) =>
    haversineKm(lat, lon, p.lat, p.lon) < haversineKm(lat, lon, best.lat, best.lon) ? p : best
  );

/** "Ikeja, Lagos State" for a Nigerian coordinate, "Outside Nigeria" otherwise. */
export const formatPlace = (
  lat: number | null | undefined,
  lon: number | null | undefined
): string => {
  if (!isInNigeria(lat, lon)) return "Outside Nigeria";
  const place = nearestPlace(lat as number, lon as number);
  return `${place.name}, ${place.state} State`;
};
