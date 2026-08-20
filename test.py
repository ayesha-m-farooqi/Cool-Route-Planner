import requests
import time

# 1. API Configuration
API_KEY = ""  # Replace with your actual key
SUBMIT_URL = "https://api.fortyguard.com/v1/heatmap"

HEADERS = {
    "api-key": API_KEY,
    "Content-Type": "application/json"
}

# 2. Polygon Bounding Box for Lower Manhattan (NYC)
PAYLOAD = {
    "polygon_aoi": {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-74.0170, 40.7050],
                        [-74.0030, 40.7050],
                        [-74.0030, 40.7180],
                        [-74.0170, 40.7180],
                        [-74.0170, 40.7050]
                    ]]
                }
            }
        ]
    },
    "date_time": {
        "start_date": "2024-07-15",
        "start_time": "14:00",
        "filter_type": 1
    },
    "granularity": 100
}

# 3. Submit Task
print("Submitting heatmap request to FortyGuard...")
response = requests.post(SUBMIT_URL, headers=HEADERS, json=PAYLOAD)

if response.status_code != 200:
    print(f"Error submitting task: {response.status_code}")
    print(response.text)
    exit()

data = response.json()
activity_id = data["data"]["activity_id"]
print(f"Task submitted! Activity ID: {activity_id}")

# 4. Poll for Results
STATUS_URL = f"https://api.fortyguard.com/v1/status/{activity_id}"

print("Polling for results...")
for attempt in range(120):
    status_response = requests.get(STATUS_URL, headers={"api-key": API_KEY})
    status_data = status_response.json()["data"]
    status = status_data["status"].lower()

    if status in ("completed", "succeeded"):
        print("\nTask completed successfully!")
        print("Data Payload:", status_data)
        break
    elif status in ("failed", "error"):
        print("\nTask failed.")
        break
    else:
        print(f"Status: {status}... retrying in 5s")
        time.sleep(5)