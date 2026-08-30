# Cool Route Planner 🌡️

**FortyGuard Hackathon** | Smart Heat-Aware Navigation for Las Vegas

> Navigate smarter, stay cooler. Instead of asking *"What is the fastest route?"* — we ask *"What is the safest, coolest route?"*

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🌡️ **Thermal Heatmap** | FortyGuard temperature grid rendered as a live heatmap overlay |
| 🛣️ **Dual Routing** | NetworkX finds both the **shortest** and **heat-weighted coolest** route |
| ❄️ **Cooling Stops** | Blue pin markers highlight shaded rest stops along the corridor |
| 📊 **Heat Exposure Index** | Compares `avg_temp × travel_time` so faster modes earn credit |
| 🗺️ **Dark Matter Map** | CartoDB Dark Matter tiles — no API key required |
| 🎨 **Glassmorphic UI** | Premium dark glassmorphic design built in Vanilla CSS |

---

## 🚀 Running the App

### Prerequisites
- Python 3.10+
- Node.js 18+

### Step 1 — Start the Python Backend

```bash
cd backend
.\venv\Scripts\activate      # Windows
# source venv/bin/activate   # macOS / Linux

python app.py
```

The Flask server will:
1. Load `vegas_heatmap.geojson` temperature tiles
2. Download the Las Vegas walking network from OpenStreetMap (~30 sec first run)
3. Start serving at **http://localhost:5000**

> **Note:** The first startup takes 30–60 seconds while it downloads the OSM street graph. After that it is cached in memory.

### Step 2 — Start the Frontend

In a **new terminal**:

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 🏗️ Architecture

```
Cool-Route-Planner/
├── backend/
│   ├── app.py                  ← Flask API (3 endpoints)
│   ├── routing_engine.py       ← Core heat-weighted pathfinding
│   ├── vegas_heatmap.geojson   ← FortyGuard temperature tiles
│   ├── cooling_stops.json      ← Rest stop locations
│   └── multi_hour_data.json    ← Time-of-day temperature data
└── src/
    ├── App.jsx                 ← React frontend (map + form + results)
    └── index.css               ← Premium glassmorphic styles
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/`      | Health check |
| `GET`  | `/api/heatmap` | Returns all thermal tile centroids |
| `GET`  | `/api/cooling-stops` | Returns cooling stop locations |
| `POST` | `/api/route` | Calculates hot + cool routes |

---

## 🧠 How the Heat Score Works

The routing engine penalizes hot streets using:

```
cost = length_m × (1 + alpha × normalized_heat)
```

Where `normalized_heat` is each street segment's temperature normalized to `[0, 1]` across the entire graph. `alpha = 5.0` makes hot streets 6× more expensive than cool ones.

The **Heat Exposure Index** measures actual physiological risk:

```
heat_exposure_index = avg_temp_c × duration_minutes
```

A faster mode (bike vs walk) at the same temperature earns a significantly lower index.
