import os
import json
import time
import requests
from dotenv import load_dotenv

load_dotenv(override=True)

class FortyGuardClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.submit_url = "https://api.fortyguard.com/v1/heatmap"
        self.headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }

    def fetch_vegas_heatmap(self, bounding_box_coords, start_date="2024-07-15", start_time="14:00"):
        """Fetches a single FortyGuard heatmap task and polls until complete."""
        payload = {
            "polygon_aoi": {
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [bounding_box_coords]
                    }
                }]
            },
            "date_time": {
                "start_date": start_date,
                "start_time": start_time,
                "filter_type": 1
            },
            "granularity": 100
        }

        print(f"[FortyGuard] Submitting task for {start_time}...")
        res = requests.post(self.submit_url, headers=self.headers, json=payload, timeout=15)
        res.raise_for_status()
        
        activity_id = res.json()["data"]["activity_id"]
        status_url = f"https://api.fortyguard.com/v1/status/{activity_id}"
        
        for _ in range(60):
            status_res = requests.get(status_url, headers={"api-key": self.api_key}, timeout=10)
            status_data = status_res.json().get("data", {})
            status = status_data.get("status", "").lower()

            if status in ("completed", "succeeded"):
                print(f"[FortyGuard] Data retrieved successfully for {start_time}!")
                return status_data
            elif status in ("failed", "error"):
                raise RuntimeError(f"[FortyGuard] API Task Failed: {status_data}")
            
            time.sleep(3)

        raise TimeoutError("[FortyGuard] Polling timed out.")

    def extract_grid_points(self, api_response_data):
        """Parses polygon tiles into point centroids with temperatures."""
        clean_points = []
        result_payload = api_response_data.get("result", {})
        map_data = result_payload.get("map_data", {})
        features = map_data.get("features", [])
        
        if not features and "features" in result_payload:
            features = result_payload.get("features", [])

        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            
            temp = (
                props.get("average_temperature") or 
                props.get("tcm") or 
                props.get("value") or 
                props.get("temperature") or 
                props.get("temp_c")
            )
            
            coords = geom.get("coordinates", [])
            
            if coords and temp is not None:
                if geom.get("type") == "Polygon":
                    ring = coords[0]
                    avg_lon = sum(pt[0] for pt in ring) / len(ring)
                    avg_lat = sum(pt[1] for pt in ring) / len(ring)
                    clean_points.append({"lat": avg_lat, "lon": avg_lon, "temp_c": float(temp)})
                elif geom.get("type") == "Point":
                    clean_points.append({"lat": coords[1], "lon": coords[0], "temp_c": float(temp)})
                
        return clean_points

    # =========================================================
    # NEW FEATURE 1: MULTI-HOUR DEPARTURE TIME ANALYSIS
    # =========================================================
    def fetch_multi_hour_heatmaps(self, bounding_box_coords, start_date="2024-07-15", time_slots=None):
        """
        Queries FortyGuard across multiple time windows to find optimal departure times.
        Returns a dictionary: {'10:00': [grid_points], '12:00': [grid_points], ...}
        """
        if time_slots is None:
            time_slots = ["10:00", "12:00", "14:00", "16:00"]
            
        multi_hour_data = {}
        print(f"\n[FortyGuard] Starting multi-hour analysis for time slots: {time_slots}")
        
        for slot in time_slots:
            try:
                raw_data = self.fetch_vegas_heatmap(bounding_box_coords, start_date, start_time=slot)
                multi_hour_data[slot] = self.extract_grid_points(raw_data)
            except Exception as e:
                print(f"[FortyGuard] Warning: Failed to fetch time slot {slot}: {e}")
                
        return multi_hour_data

    # =========================================================
    # NEW FEATURE 2: COOLING STOPS DETECTOR
    # =========================================================
    def find_cooling_stops(self, grid_points, top_n=3, temp_threshold=37.0):
        """
        Identifies the coldest micro-climate tiles to act as designated 
        hydration / shade rest stops for logistics and outdoor workers.
        """
        if not grid_points:
            return []

        # Sort points by temperature ascending
        sorted_points = sorted(grid_points, key=lambda x: x['temp_c'])
        
        # Filter for sub-threshold temperatures or take top N coldest
        cool_stops = [pt for pt in sorted_points if pt['temp_c'] <= temp_threshold]
        
        if len(cool_stops) < top_n:
            cool_stops = sorted_points[:top_n]
        else:
            cool_stops = cool_stops[:top_n]

        print(f"\n[FortyGuard] Identified {len(cool_stops)} Cooling Rest Stops:")
        for idx, stop in enumerate(cool_stops, 1):
            print(f"  Stop #{idx}: Lat {stop['lat']:.4f}, Lon {stop['lon']:.4f} | Temp: {stop['temp_c']}°C")

        return cool_stops

    def save_geojson_for_frontend(self, api_response_data, filename="vegas_heatmap.geojson"):
        """Saves raw map data for Member 3's map UI."""
        map_data = api_response_data.get("result", {}).get("map_data", {})
        if map_data:
            with open(filename, "w") as f:
                json.dump(map_data, f, indent=2)
            print(f"[FortyGuard] Saved GeoJSON payload to {filename}!")


# ==========================================
# EXECUTION HARNESS
# ==========================================
if __name__ == "__main__":
    VEGAS_AOI = [
        [-115.1750, 36.1100],
        [-115.1650, 36.1100],
        [-115.1650, 36.1250],
        [-115.1750, 36.1250],
        [-115.1750, 36.1100]
    ]

    api_key = os.getenv("FORTYGUARD_API_KEY")
    client = FortyGuardClient(api_key=api_key)

    # 1. Fetch primary heatmap & save GeoJSON
    raw_data = client.fetch_vegas_heatmap(VEGAS_AOI, start_time="14:00")
    points = client.extract_grid_points(raw_data)
    client.save_geojson_for_frontend(raw_data, "vegas_heatmap.geojson")

    # 2. Find Cooling Rest Stops for Outdoor Workers / Logistics
    cooling_stops = client.find_cooling_stops(points, top_n=3)

    # 3. Save cooling stops to JSON for Member 3's UI markers
    with open("cooling_stops.json", "w") as f:
        json.dump(cooling_stops, f, indent=2)
    print("[FortyGuard] Saved cooling stops to cooling_stops.json!")