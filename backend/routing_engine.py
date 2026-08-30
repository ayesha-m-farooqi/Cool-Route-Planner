"""
routing_engine.py
Member 2 (Routing Math) deliverable for Cool Route Planner - FortyGuard Hackathon

Turns FortyGuard's temperature grid (vegas_heatmap.geojson, produced by
fortyguard_pipeline.py) into two actual walkable routes on the real street
network:
    1. "Hot Route"  -> standard shortest-distance path
    2. "Cool Route" -> shortest path after penalizing hot street segments

Exposes calculate_route_heat_score(), referenced by Member 1's pipeline notes.

Requires: osmnx, networkx, shapely, numpy  (see requirements.txt)
"""

import json
import math
import numpy as np
import networkx as nx
from shapely.geometry import Point, Polygon, shape

try:
    import osmnx as ox
    OSMNX_AVAILABLE = True
except ImportError:
    OSMNX_AVAILABLE = False


# Average travel speed per mode, used to convert distance into a realistic
# travel time - which matters for delivery/outdoor-worker use cases, since
# heat exposure is really about TIME spent outdoors, not just distance.
MODE_SPEEDS_KMH = {
    "walk": 5.0,     # pedestrian
    "bike": 15.0,    # cyclist / bike courier
    "drive": 30.0,   # delivery vehicle, average city speed with stops
}

# Maps our "mode" concept to the OSM network type osmnx should download.
MODE_TO_NETWORK_TYPE = {
    "walk": "walk",
    "bike": "bike",
    "drive": "drive",
}


# ---------------------------------------------------------------------------
# 1. Load FortyGuard temperature tiles and build a lookup
# ---------------------------------------------------------------------------

class TemperatureLookup:
    """
    Wraps the 153 GeoJSON tiles from vegas_heatmap.geojson and answers
    "what's the temperature at this lat/lon?" using point-in-polygon,
    falling back to nearest-tile-center if the point is outside all tiles.
    """

    def __init__(self, geojson_path: str):
        with open(geojson_path, "r") as f:
            data = json.load(f)

        self.polygons = []       # list of (shapely Polygon, temp_c)
        self.centers = []        # list of (lat, lon) tile centers
        self.center_temps = []   # matching temp_c for nearest-neighbor fallback

        for feat in data.get("features", []):
            geom = shape(feat["geometry"])
            props = feat.get("properties", {})
            temp = (
                props.get("average_temperature")
                or props.get("tcm")
                or props.get("value")
                or props.get("temperature")
                or props.get("temp_c")
            )
            if temp is None:
                continue

            temp = float(temp)
            self.polygons.append((geom, temp))

            centroid = geom.centroid
            self.centers.append((centroid.y, centroid.x))  # (lat, lon)
            self.center_temps.append(temp)

        self.centers = np.array(self.centers)
        self.center_temps = np.array(self.center_temps)

        if len(self.centers) == 0:
            raise ValueError(f"No usable temperature tiles found in {geojson_path}")

    def temp_at(self, lat: float, lon: float) -> float:
        """Return temperature (C) at a given lat/lon."""
        pt = Point(lon, lat)

        # 1. exact tile match (point-in-polygon)
        for poly, temp in self.polygons:
            if poly.contains(pt):
                return temp

        # 2. fallback: nearest tile center (fast, no scipy dependency needed)
        d2 = (self.centers[:, 0] - lat) ** 2 + (self.centers[:, 1] - lon) ** 2
        nearest_idx = int(np.argmin(d2))
        return float(self.center_temps[nearest_idx])


class PointTemperatureLookup:
    """
    Lightweight nearest-neighbor lookup over a flat list of
    {'lat':.., 'lon':.., 'temp_c':..} points - used for multi_hour_data.json,
    which has raw points rather than GeoJSON polygon tiles.
    """

    def __init__(self, points):
        self.centers = np.array([(p["lat"], p["lon"]) for p in points])
        self.temps = np.array([p["temp_c"] for p in points])

    def temp_at(self, lat: float, lon: float) -> float:
        d2 = (self.centers[:, 0] - lat) ** 2 + (self.centers[:, 1] - lon) ** 2
        idx = int(np.argmin(d2))
        return float(self.temps[idx])


class MultiHourTemperatureData:
    """
    Wraps multi_hour_data.json - a dict of {"HH:MM": [points...]}.

    Lets you ask "what's the temperature at this location at 3pm" even
    though FortyGuard was only queried at a handful of sampled hours
    (e.g. 8:00, 11:00, 14:00, 17:00). Does this by linearly interpolating
    between the two nearest sampled time slots, per-location, rather than
    just rounding to the closest sample - a rough but honest estimate for
    times in between real data points.
    """

    def __init__(self, path: str):
        with open(path, "r") as f:
            raw = json.load(f)

        self.slots = {time_str: PointTemperatureLookup(points) for time_str, points in raw.items()}
        self.sorted_times = sorted(self.slots.keys(), key=self._to_minutes)

        if len(self.sorted_times) < 2:
            raise ValueError("multi_hour_data.json needs at least 2 time slots to interpolate")

    @staticmethod
    def _to_minutes(time_str: str) -> int:
        h, m = map(int, time_str.split(":"))
        return h * 60 + m

    def temp_at(self, lat: float, lon: float, time_str: str) -> float:
        """
        Returns an interpolated temperature at (lat, lon) for an arbitrary
        "HH:MM" time. If the requested time is outside the sampled range
        (e.g. asking about 2am when data only spans 8am-5pm), clamps to
        the nearest boundary slot rather than extrapolating wildly.
        """
        target_min = self._to_minutes(time_str)
        times_min = [self._to_minutes(t) for t in self.sorted_times]

        if target_min <= times_min[0]:
            return self.slots[self.sorted_times[0]].temp_at(lat, lon)
        if target_min >= times_min[-1]:
            return self.slots[self.sorted_times[-1]].temp_at(lat, lon)

        for i in range(len(times_min) - 1):
            t0, t1 = times_min[i], times_min[i + 1]
            if t0 <= target_min <= t1:
                temp0 = self.slots[self.sorted_times[i]].temp_at(lat, lon)
                temp1 = self.slots[self.sorted_times[i + 1]].temp_at(lat, lon)
                frac = (target_min - t0) / (t1 - t0) if t1 != t0 else 0.0
                return temp0 + frac * (temp1 - temp0)

        # Should be unreachable given the boundary checks above.
        return self.slots[self.sorted_times[-1]].temp_at(lat, lon)


# ---------------------------------------------------------------------------
# 2. Build / load the street graph and attach temperature to every edge
# ---------------------------------------------------------------------------

def build_street_graph(bounding_box_coords, mode="walk"):
    """
    bounding_box_coords: same [[lon, lat], ...] ring used in fortyguard_pipeline.py
    mode: "walk", "bike", or "drive" - determines which OSM street network
          gets downloaded (pedestrian paths vs bike lanes vs drivable roads).
    Returns a networkx MultiDiGraph from OpenStreetMap via osmnx.

    NOTE: requires internet access to OSM/Overpass servers at run time.
    """
    if not OSMNX_AVAILABLE:
        raise RuntimeError(
            "osmnx is not installed. Run: pip install osmnx"
        )
    if mode not in MODE_TO_NETWORK_TYPE:
        raise ValueError(f"mode must be one of {list(MODE_TO_NETWORK_TYPE)}, got {mode!r}")

    network_type = MODE_TO_NETWORK_TYPE[mode]

    lons = [c[0] for c in bounding_box_coords]
    lats = [c[1] for c in bounding_box_coords]
    bbox = (min(lons), min(lats), max(lons), max(lats))  # (west, south, east, north)

    print(f"[RoutingEngine] Downloading '{mode}' street network from OSM...")
    G = ox.graph_from_bbox(bbox, network_type=network_type)
    print(f"[RoutingEngine] Graph built: {len(G.nodes)} nodes, {len(G.edges)} edges")
    return G


def attach_temperatures(G, temp_lookup: TemperatureLookup):
    """
    Annotates every edge in G with a 'temp_c' attribute, using the
    temperature at the edge's midpoint.
    """
    for u, v, k, data in G.edges(keys=True, data=True):
        u_lat, u_lon = G.nodes[u]["y"], G.nodes[u]["x"]
        v_lat, v_lon = G.nodes[v]["y"], G.nodes[v]["x"]
        mid_lat = (u_lat + v_lat) / 2
        mid_lon = (u_lon + v_lon) / 2
        data["temp_c"] = temp_lookup.temp_at(mid_lat, mid_lon)
    return G


# ---------------------------------------------------------------------------
# 3. Heat score for an arbitrary route (the function Member 1 referenced)
# ---------------------------------------------------------------------------

def calculate_route_heat_score(route_points, temp_lookup: TemperatureLookup = None):
    """
    route_points: list of dicts [{'lat':.., 'lon':.., 'temp_c': optional}, ...]
                  OR list of (lat, lon) tuples if temp_lookup is provided.

    Returns a dict:
        {
            "avg_temp_c": float,
            "max_temp_c": float,
            "min_temp_c": float,
            "num_points": int
        }
    """
    temps = []

    for p in route_points:
        if isinstance(p, dict) and "temp_c" in p and p["temp_c"] is not None:
            temps.append(p["temp_c"])
        else:
            if temp_lookup is None:
                raise ValueError(
                    "route_points has no temp_c values and no temp_lookup was given"
                )
            if isinstance(p, dict):
                lat, lon = p["lat"], p["lon"]
            else:
                lat, lon = p
            temps.append(temp_lookup.temp_at(lat, lon))

    if not temps:
        raise ValueError("No points supplied to calculate_route_heat_score()")

    return {
        "avg_temp_c": round(float(np.mean(temps)), 2),
        "max_temp_c": round(float(np.max(temps)), 2),
        "min_temp_c": round(float(np.min(temps)), 2),
        "num_points": len(temps),
    }


# ---------------------------------------------------------------------------
# 4. Compute the Hot Route (fastest) and Cool Route (thermally weighted)
# ---------------------------------------------------------------------------

def _cool_weight_factory(alpha, temp_min, temp_max):
    """
    Returns a weight function usable by nx.shortest_path(weight=...).

    IMPORTANT: osmnx builds a MultiDiGraph (streets can have multiple
    parallel edges between the same two nodes). When a callable weight is
    passed to nx.shortest_path on a multigraph, NetworkX calls this
    function with the FULL dict of parallel edges - e.g.
    {0: {'length': 100, 'temp_c': 30}, 1: {...}} - not a single edge's
    attributes directly. Treating that outer dict as if it were one
    edge's attributes (e.g. d.get('length', 1.0)) silently returns the
    default every time, making every edge cost identical regardless of
    real distance or temperature. This version detects that shape and
    picks the cheapest parallel edge, matching how NetworkX's own
    built-in string-weight handling behaves for multigraphs.

    Normalizes each edge's temperature to a 0-1 scale relative to this
    graph's own min/max, so the coolest streets in THIS dataset are
    preferred over the hottest ones in THIS dataset.

    cost = length_m * (1 + alpha * normalized_heat)   where normalized_heat in [0,1]
    """
    span = max(temp_max - temp_min, 1e-6)  # avoid divide-by-zero if perfectly flat

    def _cost(attrs):
        length = attrs.get("length", 1.0)
        temp = attrs.get("temp_c", temp_min)
        normalized_heat = (temp - temp_min) / span
        return length * (1 + alpha * normalized_heat)

    def weight_fn(u, v, d):
        # Multigraph case: d is {edge_key: attr_dict, ...} - pick the
        # cheapest parallel edge, same as NetworkX does internally for
        # string weights.
        if d and all(isinstance(val, dict) for val in d.values()):
            return min(_cost(attrs) for attrs in d.values())
        # Plain Graph/DiGraph case: d IS the single edge's attr dict.
        return _cost(d)

    return weight_fn


def get_hot_and_cool_routes(G, orig_node, dest_node, alpha=3.0, mode="walk"):
    """
    Computes both routes on the same graph G (must already have 'temp_c'
    and 'length' edge attributes).

    mode: "walk", "bike", or "drive" - determines the speed used to turn
          distance into travel time, since heat exposure is a function of
          TIME spent outdoors, not just distance. A cyclist and a
          pedestrian moving through the same hot block experience very
          different amounts of actual heat exposure.

    Returns a dict with node lists and comparison stats, ready to hand to
    Member 3's frontend as GeoJSON.
    """
    if mode not in MODE_SPEEDS_KMH:
        raise ValueError(f"mode must be one of {list(MODE_SPEEDS_KMH)}, got {mode!r}")
    speed_kmh = MODE_SPEEDS_KMH[mode]

    all_temps = [data.get("temp_c") for _, _, data in G.edges(data=True) if "temp_c" in data]
    temp_min, temp_max = min(all_temps), max(all_temps)

    hot_route = nx.shortest_path(G, orig_node, dest_node, weight="length")
    cool_route = nx.shortest_path(
        G, orig_node, dest_node, weight=_cool_weight_factory(alpha, temp_min, temp_max)
    )

    def route_stats(route):
        coords = [(G.nodes[n]["y"], G.nodes[n]["x"]) for n in route]  # (lat, lon)

        edge_lengths = [
            G[route[i]][route[i + 1]][0].get("length", 0)
            for i in range(len(route) - 1)
        ]
        edge_temps = [
            G[route[i]][route[i + 1]][0].get("temp_c", temp_min)
            for i in range(len(route) - 1)
        ]
        distance_m = sum(edge_lengths)

        # distance-weighted average temperature (a long hot block should count
        # more than a short one) instead of a plain mean of edge temps
        if distance_m > 0:
            weighted_temp = sum(t * l for t, l in zip(edge_temps, edge_lengths)) / distance_m
        else:
            weighted_temp = float(np.mean(edge_temps)) if edge_temps else None

        duration_min = round((distance_m / 1000.0) / speed_kmh * 60.0, 1)

        # Heat exposure index: total "degree-minutes" spent outdoors.
        # e.g. 10 minutes at 40C = 400, twice as bad as 10 minutes at 20C.
        # This is what actually matters for a delivery worker's health risk,
        # not average temperature alone - a faster mode reduces exposure
        # even at the same average temperature.
        heat_exposure_index = (
            round(weighted_temp * duration_min, 1) if weighted_temp is not None else None
        )

        return {
            "coords": [[lon, lat] for lat, lon in coords],  # GeoJSON order [lon, lat]
            "distance_m": round(distance_m, 1),
            "avg_temp_c": round(weighted_temp, 3) if weighted_temp is not None else None,
            "duration_min": duration_min,
            "heat_exposure_index": heat_exposure_index,
        }

    hot_stats = route_stats(hot_route)
    cool_stats = route_stats(cool_route)

    heat_reduction_pct = None
    if hot_stats["avg_temp_c"] and cool_stats["avg_temp_c"]:
        heat_reduction_pct = round(
            (hot_stats["avg_temp_c"] - cool_stats["avg_temp_c"])
            / hot_stats["avg_temp_c"]
            * 100,
            1,
        )

    exposure_reduction_pct = None
    if hot_stats["heat_exposure_index"] and cool_stats["heat_exposure_index"]:
        exposure_reduction_pct = round(
            (hot_stats["heat_exposure_index"] - cool_stats["heat_exposure_index"])
            / hot_stats["heat_exposure_index"]
            * 100,
            1,
        )

    return {
        "mode": mode,
        "hot_route": {
            "type": "LineString",
            "coordinates": hot_stats["coords"],
            "distance_m": hot_stats["distance_m"],
            "avg_temp_c": hot_stats["avg_temp_c"],
            "duration_min": hot_stats["duration_min"],
            "heat_exposure_index": hot_stats["heat_exposure_index"],
        },
        "cool_route": {
            "type": "LineString",
            "coordinates": cool_stats["coords"],
            "distance_m": cool_stats["distance_m"],
            "avg_temp_c": cool_stats["avg_temp_c"],
            "duration_min": cool_stats["duration_min"],
            "heat_exposure_index": cool_stats["heat_exposure_index"],
        },
        "heat_reduction_pct": heat_reduction_pct,
        "exposure_reduction_pct": exposure_reduction_pct,
        "extra_distance_m": round(
            cool_stats["distance_m"] - hot_stats["distance_m"], 1
        ),
    }


def route_avg_temp_at_time(G, route, multi_hour_data: MultiHourTemperatureData, time_str: str):
    """
    Computes the distance-weighted average temperature along an existing
    route (list of node ids in G) AT A SPECIFIC TIME, using interpolated
    multi-hour data instead of the single-snapshot vegas_heatmap.geojson.

    Returns (avg_temp_c, distance_m).
    """
    total_dist = 0.0
    weighted_sum = 0.0
    for i in range(len(route) - 1):
        u, v = route[i], route[i + 1]
        edge_data = G[u][v][0]
        length = edge_data.get("length", 0)
        u_lat, u_lon = G.nodes[u]["y"], G.nodes[u]["x"]
        v_lat, v_lon = G.nodes[v]["y"], G.nodes[v]["x"]
        mid_lat, mid_lon = (u_lat + v_lat) / 2, (u_lon + v_lon) / 2
        temp = multi_hour_data.temp_at(mid_lat, mid_lon, time_str)
        weighted_sum += temp * length
        total_dist += length

    avg_temp = weighted_sum / total_dist if total_dist > 0 else None
    return avg_temp, total_dist


def recommend_departure_time(G, route, multi_hour_data: MultiHourTemperatureData,
                              mode="walk", candidate_times=None):
    """
    Evaluates the SAME route at several candidate departure times and
    ranks them by heat exposure (avg_temp * duration), so the app can
    answer "what's the best time to leave for this trip" rather than
    only "which street should I take".

    candidate_times: list of "HH:MM" strings to check. Defaults to the
    exact sampled slots in multi_hour_data (e.g. 08:00/11:00/14:00/17:00).
    Pass your own list (e.g. every hour) to interpolate finer-grained options.
    """
    if mode not in MODE_SPEEDS_KMH:
        raise ValueError(f"mode must be one of {list(MODE_SPEEDS_KMH)}, got {mode!r}")
    speed_kmh = MODE_SPEEDS_KMH[mode]

    if candidate_times is None:
        candidate_times = multi_hour_data.sorted_times

    options = []
    for t in candidate_times:
        avg_temp, dist = route_avg_temp_at_time(G, route, multi_hour_data, t)
        duration_min = round((dist / 1000.0) / speed_kmh * 60.0, 1)
        heat_exposure_index = round(avg_temp * duration_min, 1) if avg_temp is not None else None
        options.append({
            "time": t,
            "avg_temp_c": round(avg_temp, 2) if avg_temp is not None else None,
            "duration_min": duration_min,
            "heat_exposure_index": heat_exposure_index,
        })

    ranked = sorted(
        options,
        key=lambda o: o["heat_exposure_index"] if o["heat_exposure_index"] is not None else float("inf"),
    )

    return {
        "mode": mode,
        "distance_m": round(options[0]["duration_min"] * speed_kmh * 1000 / 60, 1) if options else None,
        "options": options,
        "best_time": ranked[0] if ranked else None,
        "worst_time": ranked[-1] if ranked else None,
    }


# ---------------------------------------------------------------------------
# 5. Demo / test harness
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Same bounding box used in fortyguard_pipeline.py
    VEGAS_AOI = [
        [-115.1750, 36.1100],
        [-115.1650, 36.1100],
        [-115.1650, 36.1250],
        [-115.1750, 36.1250],
        [-115.1750, 36.1100],
    ]

    temp_lookup = TemperatureLookup("vegas_heatmap.geojson")

    # Quick sanity check on the heat-score function using raw grid points
    with open("vegas_heatmap.geojson") as f:
        raw = json.load(f)
    sample_points = []
    for feat in raw["features"][:10]:
        centroid = shape(feat["geometry"]).centroid
        sample_points.append({"lat": centroid.y, "lon": centroid.x,
                               "temp_c": feat["properties"].get("average_temperature")})
    print("Heat score for first 10 tiles:", calculate_route_heat_score(sample_points))

    # Full route comparison (requires internet access for OSM download)
    # Multi-hour / best-departure-time demo (works offline, no OSM needed
    # for the interpolation logic itself - only for the route distances).
    try:
        multi_hour = MultiHourTemperatureData("multi_hour_data.json")
        print("\nMulti-hour data loaded. Sampled times:", multi_hour.sorted_times)
        sample_lat, sample_lon = 36.1170, -115.1730
        for t in ["08:00", "09:30", "11:00", "13:00", "14:00", "16:00", "17:00"]:
            temp = multi_hour.temp_at(sample_lat, sample_lon, t)
            marker = "(sampled)" if t in multi_hour.sorted_times else "(interpolated)"
            print(f"  {t} {marker}: {temp:.2f}C")
    except FileNotFoundError:
        print("[RoutingEngine] multi_hour_data.json not found - skipping time-of-day demo.")

    if OSMNX_AVAILABLE:
        try:
            # Change this to "walk", "bike", or "drive" depending on the
            # scenario you're demoing (pedestrian, courier, delivery vehicle).
            MODE = "walk"

            G = build_street_graph(VEGAS_AOI, mode=MODE)
            G = attach_temperatures(G, temp_lookup)

            # Demo start/end points: the closest pair of genuinely hot and
            # cool tiles found in the INTERIOR of the AOI (away from the
            # bounding box edges, where the street network gets artificially
            # cut off and offers no real alternate routes). This pair is
            # 761m apart with a real 0.37C difference - the best local
            # contrast available in the current dataset.
            ORIGIN = (36.1087, -115.1777)         # hot interior tile
            DESTINATION = (36.1150, -115.1742)    # cool interior tile, 761m away

            orig = ox.distance.nearest_nodes(G, ORIGIN[1], ORIGIN[0])
            dest = ox.distance.nearest_nodes(G, DESTINATION[1], DESTINATION[0])

            result = get_hot_and_cool_routes(G, orig, dest, alpha=5.0, mode=MODE)
            print(json.dumps(result, indent=2))

            # Now answer the more useful question for this pitch: given THIS
            # route, what's the best time of day to make the trip?
            try:
                multi_hour = MultiHourTemperatureData("multi_hour_data.json")
                hot_route_nodes = nx.shortest_path(G, orig, dest, weight="length")
                departure_advice = recommend_departure_time(
                    G, hot_route_nodes, multi_hour, mode=MODE
                )
                print("\n=== Best time to leave for this route ===")
                print(json.dumps(departure_advice, indent=2))
            except FileNotFoundError:
                print("[RoutingEngine] multi_hour_data.json not found - skipping departure-time demo.")
        except Exception as e:
            print(f"[RoutingEngine] Could not build live street graph: {e}")
            print("[RoutingEngine] (Needs internet access to OSM/Overpass servers.)")
    else:
        print("[RoutingEngine] osmnx not installed - install it to run the full demo.")