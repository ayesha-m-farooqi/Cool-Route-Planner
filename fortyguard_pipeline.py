import requests
import time

class FortyGuardClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.submit_url = "https://api.fortyguard.com/v1/heatmap"
        self.headers = {
            "api-key": self.api_key,
            "Content-Type": "application/json"
        }

    def fetch_vegas_heatmap(self, bounding_box_coords, start_date="2024-07-15", start_time="14:00"):
        """
        Submits a heatmap job for a Nevada polygon AOI, polls for completion, 
        and returns parsed temperature data.
        """
        payload = {
            "polygon_aoi": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [bounding_box_coords]
                        }
                    }
                ]
            },
            "date_time": {
                "start_date": start_date,
                "start_time": start_time,
                "filter_type": 1
            },
            "granularity": 100
        }

        # Step 1: Submit Task
        print("[FortyGuard] Submitting heatmap task...")
        res = requests.post(self.submit_url, headers=self.headers, json=payload)
        res.raise_for_status()
        
        activity_id = res.json()["data"]["activity_id"]
        print(f"[FortyGuard] Task queued! Activity ID: {activity_id}")

        # Step 2: Poll Status
        status_url = f"https://api.fortyguard.com/v1/status/{activity_id}"
        
        for attempt in range(60):
            status_res = requests.get(status_url, headers={"api-key": self.api_key})
            status_data = status_res.json().get("data", {})
            status = status_data.get("status", "").lower()

            if status in ("completed", "succeeded"):
                print("[FortyGuard] Data retrieved successfully!")
                return status_data
            elif status in ("failed", "error"):
                raise RuntimeError(f"[FortyGuard] API Task Failed: {status_data}")
            
            time.sleep(3)

        raise TimeoutError("[FortyGuard] Polling timed out.")

    def extract_grid_points(self, api_response_data):
        clean_points = []
        
        result_payload = api_response_data.get("result", {})
        map_data = result_payload.get("map_data", {})
        features = map_data.get("features", [])
        
        if not features and "features" in result_payload:
            features = result_payload.get("features", [])

        print(f"[FortyGuard] Found {len(features)} total heatmap polygon tiles.")

        for feat in features:
            props = feat.get("properties", {})
            geom = feat.get("geometry", {})
            
            # --- UPDATED HERE: Check for average_temperature ---
            temp = (
                props.get("average_temperature") or 
                props.get("tcm") or 
                props.get("value") or 
                props.get("temperature") or 
                props.get("temp_c")
            )
            
            coords = geom.get("coordinates", [])
            
            if coords and temp is not None:
                geom_type = geom.get("type", "")
                
                if geom_type == "Polygon":
                    ring = coords[0]  # Array of [lon, lat]
                    avg_lon = sum(pt[0] for pt in ring) / len(ring)
                    avg_lat = sum(pt[1] for pt in ring) / len(ring)
                    
                    clean_points.append({
                        "lat": avg_lat,
                        "lon": avg_lon,
                        "temp_c": float(temp)
                    })
                elif geom_type == "Point":
                    clean_points.append({
                        "lat": coords[1],
                        "lon": coords[0],
                        "temp_c": float(temp)
                    })
                
        return clean_points


# ==========================================
# NEVADA / LAS VEGAS TEST HARNESS
# ==========================================
if __name__ == "__main__":
    # Las Vegas Strip Bounding Box (Nevada)
    VEGAS_AOI = [
        [-115.1750, 36.1100],
        [-115.1650, 36.1100],
        [-115.1650, 36.1250],
        [-115.1750, 36.1250],
        [-115.1750, 36.1100]
    ]

    # Replace with your API key
    client = FortyGuardClient(api_key="api_key_here")
    
    # Run pipeline
    raw_data = client.fetch_vegas_heatmap(VEGAS_AOI)
    temperature_points = client.extract_grid_points(raw_data)
    
    print(f"\nExtracted {len(temperature_points)} temperature grid points for Las Vegas!")
    if temperature_points:
        print("Sample point:", temperature_points[0])