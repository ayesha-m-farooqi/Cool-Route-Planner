from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import osmnx as ox

ox.settings.timeout = 300

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HEATMAP_PATH = os.path.join(BASE_DIR, "vegas_heatmap.geojson")
COOLING_STOPS_PATH = os.path.join(BASE_DIR, "cooling_stops.json")
MULTI_HOUR_PATH = os.path.join(BASE_DIR, "multi_hour_data.json")

import routing_engine

app = Flask(__name__)
CORS(app)

# Global graph state
print("Initializing routing engine and building graph. This may take a moment...")

# The bounding box from the demo code
VEGAS_AOI = [
    [-115.1750, 36.1100],
    [-115.1650, 36.1100],
    [-115.1650, 36.1250],
    [-115.1750, 36.1250],
    [-115.1750, 36.1100],
]

temp_lookup = routing_engine.TemperatureLookup(HEATMAP_PATH)

graphs = {}

def get_graph(mode):
    if mode not in graphs:
        print(f"Building graph for {mode}...")
        G = routing_engine.build_street_graph(VEGAS_AOI, mode=mode)
        G = routing_engine.attach_temperatures(G, temp_lookup)
        graphs[mode] = G
    return graphs[mode]

# Pre-build walk graph
get_graph("walk")
print("Routing engine ready.")

@app.route('/')
def health():
    return jsonify({
        "status": "Cool Route Planner API is running",
        "endpoints": ["/api/route", "/api/heatmap", "/api/heatmap/timeline", "/api/cooling-stops"]
    })

@app.route('/api/heatmap/timeline', methods=['GET'])
def get_heatmap_timeline():
    """Return available hours in multi_hour_data.json."""
    try:
        if os.path.exists(MULTI_HOUR_PATH):
            with open(MULTI_HOUR_PATH, "r") as f:
                multi_data = json.load(f)
            return jsonify({
                "hours": list(multi_data.keys()),
                "default": "14:00" if "14:00" in multi_data else (list(multi_data.keys())[0] if multi_data else None)
            })
        return jsonify({"hours": ["14:00"], "default": "14:00"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/heatmap', methods=['GET'])
def get_heatmap():
    """Return heatmap points [lat, lon, temp] from multi_hour_data.json or vegas_heatmap.geojson."""
    hour = request.args.get('hour')
    try:
        if hour and os.path.exists(MULTI_HOUR_PATH):
            with open(MULTI_HOUR_PATH, "r") as f:
                multi_data = json.load(f)
            if hour in multi_data:
                points = [
                    {"lat": p["lat"], "lon": p["lon"], "temp": float(p.get("temp_c", p.get("temp", 35.0)))}
                    for p in multi_data[hour]
                ]
                return jsonify(points)

        with open(HEATMAP_PATH, "r") as f:
            data = json.load(f)
        points = []
        for feat in data.get("features", []):
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
            geom = feat.get("geometry", {})
            coords = geom.get("coordinates", [])
            if geom.get("type") == "Polygon" and coords:
                ring = coords[0]
                lon = sum(c[0] for c in ring) / len(ring)
                lat = sum(c[1] for c in ring) / len(ring)
                points.append({"lat": lat, "lon": lon, "temp": float(temp)})
        return jsonify(points)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/cooling-stops', methods=['GET'])
def get_cooling_stops():
    """Return cooling stop locations."""
    try:
        with open(COOLING_STOPS_PATH, "r") as f:
            stops = json.load(f)
        return jsonify(stops)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/route', methods=['POST'])
def get_route():
    data = request.json or {}
    start = data.get('start')
    end = data.get('end')
    mode = data.get('mode', 'walk')
    alpha = float(data.get('alpha', 5.0))

    if not start or not end:
        return jsonify({"error": "Missing start or end coordinates"}), 400

    start_lat, start_lon = float(start['lat']), float(start['lon'])
    end_lat, end_lon = float(end['lat']), float(end['lon'])

    try:
        G = get_graph('walk')  # Always use walk graph for demo robustness in bounding box
        orig = ox.distance.nearest_nodes(G, start_lon, start_lat)
        dest = ox.distance.nearest_nodes(G, end_lon, end_lat)

        result = routing_engine.get_hot_and_cool_routes(G, orig, dest, alpha=alpha, mode=mode)
        return jsonify(result)
    except Exception as e:
        print(f"Error calculating route: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True)
