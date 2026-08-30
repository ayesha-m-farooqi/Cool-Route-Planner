import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import {
  MapPin,
  Navigation,
  Thermometer,
  Clock,
  Activity,
  TreePine,
  Flame,
  Wind,
  Snowflake,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import L from 'leaflet';

// ── Fix Leaflet's broken default icon paths under bundlers ──
import markerIconUrl    from 'leaflet/dist/images/marker-icon.png';
import markerShadowUrl  from 'leaflet/dist/images/marker-shadow.png';
import markerIcon2xUrl  from 'leaflet/dist/images/marker-icon-2x.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       markerIconUrl,
  shadowUrl:     markerShadowUrl,
  iconRetinaUrl: markerIcon2xUrl,
  iconSize:    [20, 33],
  iconAnchor:  [10, 33],
  popupAnchor: [1, -30],
  shadowSize:  [33, 33],
});

// ── Cooling Stop icon ──
const CoolingIcon = L.divIcon({
  html: `<div style="
    background: rgba(37,99,235,0.92);
    border: 2px solid #93c5fd;
    border-radius: 50%;
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px;
    box-shadow: 0 0 12px rgba(59,130,246,0.7), 0 2px 6px rgba(0,0,0,0.5);
  ">❄️</div>`,
  className: '',
  iconSize:    [30, 30],
  iconAnchor:  [15, 15],
  popupAnchor: [0, -18],
});

// ── Thermal heatmap layer via leaflet.heat ──
function HeatmapLayer({ points }) {
  const map     = useMap();
  const heatRef = useRef(null);

  useEffect(() => {
    if (!points || points.length === 0) return;

    const temps = points.map(p => p.temp);
    const minT  = Math.min(...temps);
    const maxT  = Math.max(...temps);
    const span  = maxT - minT || 1;

    const data = points.map(p => [p.lat, p.lon, (p.temp - minT) / span]);

    if (heatRef.current) { map.removeLayer(heatRef.current); }

    heatRef.current = L.heatLayer(data, {
      radius:  28,
      blur:    22,
      maxZoom: 18,
      gradient: {
        0.00: '#1e3a5f',
        0.25: '#2563eb',
        0.50: '#facc15',
        0.75: '#ea580c',
        1.00: '#991b1b',
      },
    }).addTo(map);

    return () => { if (heatRef.current) map.removeLayer(heatRef.current); };
  }, [points, map]);

  return null;
}

// ── Map Legend ──
function MapLegend({ hasRoutes }) {
  return (
    <div className="map-legend">
      <div className="map-legend-title">Legend</div>
      {hasRoutes && (
        <>
          <div className="legend-row">
            <div className="legend-line" style={{ background: '#10b981', height: 4 }} />
            <span>Coolest Route</span>
          </div>
          <div className="legend-row">
            <div className="legend-line" style={{ background: '#ef4444', height: 3, opacity: 0.8 }} />
            <span>Fastest Route</span>
          </div>
        </>
      )}
      <div className="legend-row">
        <div className="legend-dot" style={{ background: 'rgba(37,99,235,0.9)', borderColor: '#93c5fd' }} />
        <span>❄️ Cooling Stop</span>
      </div>
      <div className="legend-row">
        <div className="legend-gradient" />
        <span>Heat Intensity</span>
      </div>
    </div>
  );
}

// ── Stat card helper ──
function Stat({ icon: Icon, label, value, color }) {
  return (
    <div className="stat-item">
      <Icon className="stat-icon" size={14} color={color || undefined} />
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
const MODES = [
  { id: 'walking',  label: 'Walking',  emoji: '🚶' },
  { id: 'cycling',  label: 'Cycling',  emoji: '🚲' },
  { id: 'delivery', label: 'Delivery', emoji: '📦' },
];

const MAP_CENTER = [36.1118, -115.176];

export default function App() {
  const [start,       setStart]       = useState('Area15');
  const [destination, setDestination] = useState('Omega Mart');
  const [mode,        setMode]        = useState('walking');
  const [loading,     setLoading]     = useState(false);
  const [routeData,   setRouteData]   = useState(null);
  const [error,       setError]       = useState(null);

  // Async data layers
  const [heatPts,  setHeatPts]  = useState([]);
  const [coolStops, setCoolStops] = useState([]);
  const [layerStatus, setLayerStatus] = useState({ heat: 'loading', stops: 'loading' });

  useEffect(() => {
    axios.get('http://localhost:5000/api/heatmap')
      .then(r => { setHeatPts(r.data); setLayerStatus(s => ({ ...s, heat: 'active' })); })
      .catch(() => setLayerStatus(s => ({ ...s, heat: 'idle' })));

    axios.get('http://localhost:5000/api/cooling-stops')
      .then(r => { setCoolStops(r.data); setLayerStatus(s => ({ ...s, stops: 'active' })); })
      .catch(() => setLayerStatus(s => ({ ...s, stops: 'idle' })));
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRouteData(null);

    try {
      const { data } = await axios.post('http://localhost:5000/api/route', {
        start: { lat: 36.1087, lon: -115.1777 },
        end:   { lat: 36.1150, lon: -115.1742 },
        mode:  mode === 'walking' ? 'walk' : mode === 'cycling' ? 'bike' : 'drive',
      });
      setRouteData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Backend unreachable. Is the Flask server running on port 5000?');
    } finally {
      setLoading(false);
    }
  };

  // Coordinate order: backend sends [lon, lat] → Leaflet needs [lat, lon]
  const hotPath  = routeData?.hot_route?.coordinates?.map(c => [c[1], c[0]])  || [];
  const coolPath = routeData?.cool_route?.coordinates?.map(c => [c[1], c[0]]) || [];

  return (
    <div className="app-wrapper">
      {/* ══ HEADER ══════════════════════════════════════════════ */}
      <header className="app-header">
        <div className="app-header-brand">
          <Wind size={26} color="#60a5fa" />
          <h1>Cool Route Planner</h1>
        </div>
        <div className="header-badges">
          <span className="header-badge hackathon">FortyGuard Hackathon</span>
          <span className="header-badge live">
            <span className="live-dot" />
            Live Data
          </span>
        </div>
      </header>

      {/* ══ BODY ════════════════════════════════════════════════ */}
      <div className="app-body">

        {/* ── LEFT PANEL ── */}
        <aside className="left-panel">

          {/* Search Form */}
          <div className="panel-section">
            <p className="panel-title">Plan Your Route</p>
            <form className="route-form" onSubmit={handleSearch}>

              <div className="form-group">
                <label htmlFor="start-input">Starting Location</label>
                <div className="input-wrapper">
                  <MapPin className="input-icon" size={15} />
                  <input
                    id="start-input"
                    type="text"
                    className="input-field"
                    placeholder="e.g. Area15"
                    value={start}
                    onChange={e => setStart(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="dest-input">Destination</label>
                <div className="input-wrapper">
                  <Navigation className="input-icon" size={15} />
                  <input
                    id="dest-input"
                    type="text"
                    className="input-field"
                    placeholder="e.g. Omega Mart"
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Travel Mode</label>
                <div className="mode-selector">
                  {MODES.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      className={`mode-btn ${mode === m.id ? 'active' : ''}`}
                      onClick={() => setMode(m.id)}
                    >
                      <span className="mode-emoji">{m.emoji}</span>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className={`submit-btn ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading ? '⟳  Analyzing Heat Corridor…' : '🌡️  Find Coolest Route'}
              </button>

              {error && (
                <div className="error-msg">
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  {error}
                </div>
              )}
            </form>
          </div>

          {/* Data Layers */}
          <div className="panel-section">
            <p className="panel-title">Live Data Layers</p>
            <div className="data-layers">
              <div className="data-layer-row">
                <div className="data-layer-label">
                  <span className={`status-dot ${layerStatus.heat}`} />
                  🌡️ Thermal Grid
                </div>
                <span className="data-layer-count">{heatPts.length} tiles</span>
              </div>
              <div className="data-layer-row">
                <div className="data-layer-label">
                  <span className={`status-dot ${layerStatus.stops}`} />
                  ❄️ Cooling Stops
                </div>
                <span className="data-layer-count">{coolStops.length} stops</span>
              </div>
            </div>
          </div>

          {/* Route Cards */}
          {routeData && (
            <div className="panel-section">
              <p className="panel-title">Route Comparison</p>
              <div className="route-cards">

                {/* Coolest Route */}
                <div className="route-card cool">
                  <div className="route-card-header">
                    <div className="route-title">
                      <TreePine size={16} color="#10b981" />
                      Coolest Route
                    </div>
                    <span className="badge cool">Recommended</span>
                  </div>
                  <div className="route-stats">
                    <Stat icon={Thermometer} label="Avg Temp"  value={`${routeData.cool_route.avg_temp_c}°C`} />
                    <Stat icon={Navigation}  label="Distance"  value={`${routeData.cool_route.distance_m} m`} />
                    <Stat icon={Clock}       label="Travel Time" value={`${routeData.cool_route.duration_min} min`} />
                    <Stat icon={Activity}    label="Heat Index" value={routeData.cool_route.heat_exposure_index} />
                  </div>
                </div>

                {/* Fastest Route */}
                <div className="route-card fast">
                  <div className="route-card-header">
                    <div className="route-title">
                      <Flame size={16} color="#ef4444" />
                      Fastest Route
                    </div>
                    <span className="badge hot">High Risk</span>
                  </div>
                  <div className="route-stats">
                    <Stat icon={Thermometer} label="Avg Temp"  value={`${routeData.hot_route.avg_temp_c}°C`} />
                    <Stat icon={Navigation}  label="Distance"  value={`${routeData.hot_route.distance_m} m`} />
                    <Stat icon={Clock}       label="Travel Time" value={`${routeData.hot_route.duration_min} min`} />
                    <Stat icon={Activity}    label="Heat Index" value={routeData.hot_route.heat_exposure_index} />
                  </div>
                </div>

                {/* Summary */}
                <div className="route-card info">
                  <div style={{ fontSize: '0.82rem', lineHeight: 1.65, color: '#cbd5e1' }}>
                    <Zap size={13} style={{ display:'inline', marginRight: 4, verticalAlign: 'middle' }} color="#60a5fa" />
                    The Coolest Route reduces your heat exposure by{' '}
                    <strong style={{ color: '#34d399' }}>{Math.abs(routeData.exposure_reduction_pct)}%</strong>
                    {' '}with only <strong style={{ color: '#fbbf24' }}>{routeData.extra_distance_m} m</strong> extra distance.
                    {coolStops.length > 0 && (
                      <> There are <strong style={{ color: '#93c5fd' }}>{coolStops.length} ❄️ cooling stops</strong> along the corridor.</>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* How it works (placeholder when no route yet) */}
          {!routeData && (
            <div className="panel-section">
              <p className="panel-title">How It Works</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {[
                  { n: '01', t: 'Thermal Analysis', d: 'FortyGuard temperature grid overlaid on the street network' },
                  { n: '02', t: 'Dual Pathfinding',  d: 'NetworkX finds shortest and heat-weighted coolest routes' },
                  { n: '03', t: 'Smart Comparison',  d: 'Real heat exposure index (temp × time) compared per route' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 4, padding: '0.15rem 0.4rem', flexShrink: 0 }}>{s.n}</span>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f1f5f9' }}>{s.t}</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', lineHeight: 1.4 }}>{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </aside>

        {/* ── RIGHT PANEL (MAP) ── */}
        <main className="right-panel">
          <div className="map-container-wrapper">

            {/* Info chip */}
            <div className="map-chip">
              <strong>Las Vegas Heat Corridor</strong>
              FortyGuard AOI · 36.11°N, 115.17°W
            </div>

            <MapContainer
              center={MAP_CENTER}
              zoom={15}
              style={{ height: '100%', width: '100%' }}
              zoomControl={true}
            >
              {/* CartoDB Dark Matter — free, no API key */}
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                subdomains="abcd"
                maxZoom={20}
              />

              {/* Thermal heatmap overlay */}
              {heatPts.length > 0 && <HeatmapLayer points={heatPts} />}

              {/* Cool route — solid green */}
              {coolPath.length > 0 && (
                <Polyline
                  positions={coolPath}
                  pathOptions={{ color: '#10b981', weight: 6, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
                />
              )}

              {/* Hot route — dashed red */}
              {hotPath.length > 0 && (
                <Polyline
                  positions={hotPath}
                  pathOptions={{ color: '#ef4444', weight: 4, opacity: 0.7, dashArray: '9, 13' }}
                />
              )}

              {/* Start marker */}
              {hotPath.length > 0 && (
                <Marker position={hotPath[0]}>
                  <Popup>
                    <div className="popup-title">📍 Start</div>
                    <div className="popup-detail">{start}</div>
                  </Popup>
                </Marker>
              )}

              {/* Destination marker */}
              {hotPath.length > 0 && (
                <Marker position={hotPath[hotPath.length - 1]}>
                  <Popup>
                    <div className="popup-title">🏁 Destination</div>
                    <div className="popup-detail">{destination}</div>
                  </Popup>
                </Marker>
              )}

              {/* ❄️ Cooling Stop pins */}
              {coolStops.map((stop, idx) => (
                <Marker key={idx} position={[stop.lat, stop.lon]} icon={CoolingIcon}>
                  <Popup>
                    <div className="popup-title">❄️ Cooling Stop #{idx + 1}</div>
                    <div className="popup-detail">
                      Temp: {stop.temp_c?.toFixed(2)}°C<br />
                      <span style={{ color: '#60a5fa' }}>Shaded rest area — reduce heat exposure here</span>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>

            <MapLegend hasRoutes={routeData != null} />
          </div>
        </main>
      </div>
    </div>
  );
}
