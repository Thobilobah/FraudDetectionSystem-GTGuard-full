"""Nigerian places table + coordinate helpers.

The platform is a Nigerian fraud-detection demo, so every generated or
displayed coordinate must sit inside Nigeria, and every coordinate pair
should be explainable to a user as a real place ("Ikeja, Lagos State").
The place table is deliberately embedded (state capitals + major cities)
instead of calling a reverse-geocoding API: zero latency, no API key, no
network dependency, and deterministic behaviour inside serverless functions.
"""

import math
import random

# (place_name, state, latitude, longitude) - 36 state capitals + FCT Abuja
# plus Lagos (commercial hub). Coordinates are approximate city centres,
# plenty for nearest-city labelling at country scale.
NIGERIAN_PLACES: list[tuple[str, str, float, float]] = [
    ("Abuja (FCT)", "FCT", 9.0579, 7.4951),
    ("Lagos", "Lagos", 6.5244, 3.3792),
    ("Ikeja", "Lagos", 6.6018, 3.3515),
    ("Kano", "Kano", 12.0022, 8.5920),
    ("Ibadan", "Oyo", 7.3775, 3.9470),
    ("Port Harcourt", "Rivers", 4.8156, 7.0498),
    ("Benin City", "Edo", 6.3350, 5.6037),
    ("Kaduna", "Kaduna", 10.5105, 7.4165),
    ("Abeokuta", "Ogun", 7.1475, 3.3619),
    ("Awka", "Anambra", 6.2127, 7.0726),
    ("Umuahia", "Abia", 5.4950, 7.4950),
    ("Maiduguri", "Borno", 11.8333, 13.1500),
    ("Bauchi", "Bauchi", 10.3158, 9.8443),
    ("Akure", "Ondo", 7.2467, 5.2014),
    ("Enugu", "Enugu", 6.4584, 7.5467),
    ("Abakaliki", "Ebonyi", 6.3284, 8.1110),
    ("Calabar", "Cross River", 4.8156, 8.3270),
    ("Asaba", "Delta", 6.1983, 6.7333),
    ("Damaturu", "Yobe", 11.7470, 11.9658),
    ("Dutse", "Jigawa", 11.7564, 9.3395),
    ("Ado-Ekiti", "Ekiti", 7.7189, 5.3107),
    ("Gombe", "Gombe", 10.2897, 11.1687),
    ("Ilorin", "Kwara", 8.4966, 4.5421),
    ("Jos", "Plateau", 9.8965, 8.8583),
    ("Katsina", "Katsina", 12.9908, 7.6018),
    ("Lokoja", "Kogi", 7.8016, 6.7456),
    ("Makurdi", "Benue", 7.7300, 8.5100),
    ("Minna", "Niger", 9.6152, 6.5478),
    ("Yola", "Adamawa", 9.2610, 12.4740),
    ("Osogbo", "Osun", 7.7561, 4.5667),
    ("Owerri", "Imo", 5.4833, 7.0500),
    ("Sokoto", "Sokoto", 13.0622, 5.2339),
    ("Uyo", "Akwa Ibom", 5.0390, 7.9430),
    ("Yenagoa", "Bayelsa", 4.9267, 6.2670),
    ("Jalingo", "Taraba", 8.8934, 11.3622),
    ("Lafia", "Nasarawa", 8.4966, 8.5167),
    ("Gusau", "Zamfara", 11.9239, 6.6890),
    ("Birnin Kebbi", "Kebbi", 12.4551, 4.1967),
]

# Tight bounding box around Nigeria (with a small inset so edge points are
# still recognisably inside the country, not on the border line).
NG_LAT_MIN, NG_LAT_MAX = 4.27, 13.90
NG_LON_MIN, NG_LON_MAX = 2.67, 14.68


def is_in_nigeria(latitude: float | None, longitude: float | None) -> bool:
    if latitude is None or longitude is None:
        return False
    return (
        NG_LAT_MIN <= latitude <= NG_LAT_MAX
        and NG_LON_MIN <= longitude <= NG_LON_MAX
    )


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_place(latitude: float, longitude: float) -> tuple[str, str, float, float]:
    """Closest tabled place to the given coordinate (haversine)."""
    return min(
        NIGERIAN_PLACES,
        key=lambda p: haversine_km(latitude, longitude, p[2], p[3]),
    )


def format_place(latitude: float | None, longitude: float | None) -> str:
    """'Ikeja, Lagos State' for a coordinate pair; callers decide how to
    render the outside-Nigeria case (we keep the wording identical to the
    frontend util so every screen says the same thing)."""
    if not is_in_nigeria(latitude, longitude):
        return "Outside Nigeria"
    place, state, _, _ = nearest_place(latitude, longitude)  # type: ignore[arg-type]
    return f"{place}, {state} State"


def random_place() -> tuple[str, str, float, float]:
    return random.choice(NIGERIAN_PLACES)


def jittered_place(jitter: float = 0.01) -> tuple[float, float, float, float]:
    """Random Nigerian place + small random offset so bulk rewrites do not
    collapse every row onto identical city-centre coordinates."""
    _, _, lat, lon = random_place()
    return (
        round(lat + random.uniform(-jitter, jitter), 4),
        round(lon + random.uniform(-jitter, jitter), 4),
        lat,
        lon,
    )


def clamp_to_nigeria(latitude: float, longitude: float) -> tuple[float, float]:
    """Pull a coordinate back inside the country bbox (small inset so the
    result never sits exactly on the border)."""
    return (
        min(max(latitude, NG_LAT_MIN + 0.05), NG_LAT_MAX - 0.05),
        min(max(longitude, NG_LON_MIN + 0.05), NG_LON_MAX - 0.05),
    )


def far_nigerian_city(from_lat: float, from_lon: float,
                      min_km: float = 500.0) -> tuple[float, float]:
    """A Nigerian city at least `min_km` away from the origin - used by the
    high-risk scenario's impossible-travel jump. The jump must stay inside
    Nigeria while still being far enough (500+ km) to plausibly trip the
    >800km/h velocity rule against the 2-minutes-ago context row."""
    candidates = [
        (lat, lon)
        for _, _, lat, lon in NIGERIAN_PLACES
        if haversine_km(from_lat, from_lon, lat, lon) >= min_km
    ]
    if not candidates:  # degenerate: fall back to any other place
        candidates = [(lat, lon) for _, _, lat, lon in NIGERIAN_PLACES]
    return random.choice(candidates)
