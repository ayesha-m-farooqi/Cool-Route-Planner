const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
import { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import {
  Compass,
  TreePine,
  Flame,
  Wind,
  Snowflake,
  Zap,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Layers,
  Download,
  Share2,
  Sun,
  Droplets,
  ShieldCheck,
  ArrowRight,
  Crosshair,
  Sliders,
  Check,
  Footprints,
  Bike,
  Truck,
  Sparkles,
  RefreshCw,
  Activity,
} from 'lucide-react';
import L from 'leaflet';

// ── Fix Leaflet default marker icons ──
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
  iconRetinaUrl: markerIcon2xUrl,
  iconSize: [22, 36],
  iconAnchor: [11, 36],
  popupAnchor: [1, -32],
  shadowSize: [36, 36],
});

// ── Custom Div Icons ──
const StartIcon = L.divIcon({
  html: `<div class="custom-pin start-pin"><div class="pin-inner">🟢</div></div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const DestIcon = L.divIcon({
  html: `<div class="custom-pin dest-pin"><div class="pin-inner">🏁</div></div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const SimNavIcon = L.divIcon({
  html: `<div class="sim-nav-marker"><div class="nav-pulse"></div><div class="nav-arrow">🧭</div></div>`,
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -18],
});

const CoolingIcon = L.divIcon({
  html: `<div class="cooling-oasis-marker">❄️</div>`,
  className: '',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18],
});

// ── Preset POIs in the Vegas Corridor ──
const PRESET_POIS = [
  { name: 'Area15 (Omega Mart)', lat: 36.1215, lon: -115.1776, desc: 'Immersive Art & Tech District' },
  { name: 'Caesars Palace', lat: 36.1162, lon: -115.1745, desc: 'Central Strip Resort' },
  { name: 'Bellagio Fountains', lat: 36.1126, lon: -115.1767, desc: 'Iconic Lake & Promenade' },
  { name: 'The LINQ Promenade', lat: 36.1180, lon: -115.1690, desc: 'Shaded Pedestrian Dining' },
  { name: 'High Roller Wheel', lat: 36.1175, lon: -115.1681, desc: 'Observation District' },
  { name: 'Flamingo Las Vegas', lat: 36.1164, lon: -115.1706, desc: 'Wildlife Habitat & Garden' },
  { name: 'The Mirage / Hard Rock', lat: 36.1211, lon: -115.1740, desc: 'North Strip Hub' },
  { name: 'Paris Las Vegas', lat: 36.1125, lon: -115.1707, desc: 'Eiffel Tower Deck' },
  { name: 'Horseshoe Las Vegas', lat: 36.1147, lon: -115.1700, desc: 'East Strip Walkway' },
];

// ── 100% Free, Premium Basemap Layers (Zero Watermarks) ──
const BASEMAPS = {
  dark: {
    name: 'Dark Canvas',
    icon: '🌙',
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    ref: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap contributors',
    maxZoom: 16,
  },
  satellite: {
    name: 'Satellite Hybrid',
    icon: '🛰️',
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ref: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
  },
  street: {
    name: 'Clean Streets',
    icon: '🗺️',
    base: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 19,
  },
  cyber: {
    name: 'Cyberpunk Matrix',
    icon: '🌆',
    base: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: ['a', 'b', 'c'],
    cssClass: 'cyberpunk-tiles',
    maxZoom: 19,
  },
};

// ── Map Events for interactive pin placement & re-centering ──
function MapClickHandler({ activePicking, onLocationPicked }) {
  useMapEvents({
    click(e) {
      if (activePicking) {
        onLocationPicked(activePicking, e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

function MapViewController({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 1) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [bounds, map]);
  return null;
}

// ── Thermal Heatmap Layer ──
function HeatmapLayer({ points, intensity = 1.0 }) {
  const map = useMap();
  const heatRef = useRef(null);

  useEffect(() => {
    if (!points || points.length === 0) return;

    const temps = points.map(p => p.temp);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const span = maxT - minT || 1;

    const data = points.map(p => [p.lat, p.lon, ((p.temp - minT) / span) * intensity]);

    if (heatRef.current) {
      map.removeLayer(heatRef.current);
    }

    heatRef.current = L.heatLayer(data, {
      radius: 30,
      blur: 24,
      maxZoom: 18,
      gradient: {
        0.00: '#1e3a8a',
        0.20: '#0284c7',
        0.45: '#10b981',
        0.65: '#facc15',
        0.85: '#f97316',
        1.00: '#dc2626',
      },
    }).addTo(map);

    return () => {
      if (heatRef.current) map.removeLayer(heatRef.current);
    };
  }, [points, intensity, map]);

  return null;
}

const MODES = [
  { id: 'walking', label: 'Walking', emoji: '🚶', speed: 4.5, icon: Footprints },
  { id: 'cycling', label: 'Cycling', emoji: '🚲', speed: 15.0, icon: Bike },
  { id: 'delivery', label: 'EV / Delivery', emoji: '📦', speed: 25.0, icon: Truck },
];

const MAP_CENTER = [36.1170, -115.1710];

export default function App() {
  // Navigation & Coordinate State
  const [startName, setStartName] = useState('Area15 (Omega Mart)');
  const [startCoords, setStartCoords] = useState({ lat: 36.1215, lon: -115.1776 });

  const [destName, setDestName] = useState('Bellagio Fountains');
  const [destCoords, setDestCoords] = useState({ lat: 36.1126, lon: -115.1767 });

  const [mode, setMode] = useState('walking');
  const [heatTolerance, setHeatTolerance] = useState(5.0); // alpha
  const [activePicking, setActivePicking] = useState(null); // 'start' | 'dest' | null

  // Basemap & Visual Layers
  const [basemapKey, setBasemapKey] = useState('dark');
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showCoolingStops, setShowCoolingStops] = useState(true);

  // Multi-Hour Heat Timeline
  const [availableHours, setAvailableHours] = useState(['08:00', '11:00', '14:00', '17:00']);
  const [selectedHour, setSelectedHour] = useState('14:00');
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);

  // Data & Results
  const [heatPts, setHeatPts] = useState([]);
  const [coolStops, setCoolStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [error, setError] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Live Simulated Navigation State
  const [isNavigating, setIsNavigating] = useState(false);
  const [navIndex, setNavIndex] = useState(0);
  const [navVoice, setNavVoice] = useState(true);
  const simTimerRef = useRef(null);

  // Fetch initial data layers
  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/heatmap/timeline`)
      .then(r => setAvailableHours(r.data))
      .catch(() => {});

    axios.get(`${API_BASE_URL}/api/cooling-stops`)
      .then(r => setCoolStops(r.data))
      .catch(() => {});
  }, []);

  // Fetch heatmap for selected hour
  useEffect(() => {
    axios.get(`${API_BASE_URL}/api/heatmap?hour=${selectedHour}`)
      .then(r => setHeatPts(r.data))
      .catch(() => {
        axios.get(`${API_BASE_URL}/api/heatmap`)
          .then(r => setHeatPts(r.data))
          .catch(() => {});
      });
  }, [selectedHour]);

  // Timeline auto-playback
  useEffect(() => {
    let interval = null;
    if (isPlayingTimeline) {
      interval = setInterval(() => {
        setSelectedHour(curr => {
          const idx = availableHours.indexOf(curr);
          const nextIdx = (idx + 1) % availableHours.length;
          return availableHours[nextIdx];
        });
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isPlayingTimeline, availableHours]);

  // Handle POI selection
  const handleSelectPreset = (type, poi) => {
    if (type === 'start') {
      setStartName(poi.name);
      setStartCoords({ lat: poi.lat, lon: poi.lon });
    } else {
      setDestName(poi.name);
      setDestCoords({ lat: poi.lat, lon: poi.lon });
    }
  };

  // Swap start and destination
  const handleSwap = () => {
    const tempName = startName;
    const tempCoords = startCoords;
    setStartName(destName);
    setStartCoords(destCoords);
    setDestName(tempName);
    setDestCoords(tempCoords);
  };

  // Map click coordinate picker
  const handleLocationPicked = (type, lat, lon) => {
    const formatted = `Pin (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
    if (type === 'start') {
      setStartName(formatted);
      setStartCoords({ lat, lon });
    } else {
      setDestName(formatted);
      setDestCoords({ lat, lon });
    }
    setActivePicking(null);
  };

  // Calculate Route
  const handleCalculateRoute = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    setIsNavigating(false);
    setNavIndex(0);

    try {
      const modeParam = mode === 'walking' ? 'walk' : mode === 'cycling' ? 'bike' : 'drive';
      const { data } = await axios.post(`${API_BASE_URL}/api/route`, {
        start: startCoords,
        end: destCoords,
        mode: modeParam,
        alpha: heatTolerance,
      });

      setRouteData(data);

      if (navVoice && 'speechSynthesis' in window) {
        const text = `Route computed. Cool corridor reduces heat exposure by ${Math.abs(data.exposure_reduction_pct)} percent.`;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Backend routing error. Ensure API server is running.');
    } finally {
      setLoading(false);
    }
  };

  // Coordinates: backend sends [lon, lat] -> Leaflet wants [lat, lon]
  const coolPath = useMemo(() => {
    return routeData?.cool_route?.coordinates?.map(c => [c[1], c[0]]) || [];
  }, [routeData]);

  const hotPath = useMemo(() => {
    return routeData?.hot_route?.coordinates?.map(c => [c[1], c[0]]) || [];
  }, [routeData]);

  // Route bounds for auto-zoom
  const routeBounds = useMemo(() => {
    if (coolPath.length === 0) return null;
    return coolPath;
  }, [coolPath]);

  // Simulated Navigation Loop
  useEffect(() => {
    if (isNavigating && coolPath.length > 0) {
      simTimerRef.current = setInterval(() => {
        setNavIndex(prev => {
          if (prev >= coolPath.length - 1) {
            setIsNavigating(false);
            if (navVoice && 'speechSynthesis' in window) {
              window.speechSynthesis.speak(new SpeechSynthesisUtterance("You have safely arrived at your destination."));
            }
            return prev;
          }
          const next = prev + 1;

          if (navVoice && next % 3 === 0 && 'speechSynthesis' in window) {
            const pct = Math.round((next / (coolPath.length - 1)) * 100);
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${pct} percent complete. Remaining in shaded path.`));
          }

          return next;
        });
      }, 1000);
    } else {
      clearInterval(simTimerRef.current);
    }
    return () => clearInterval(simTimerRef.current);
  }, [isNavigating, coolPath, navVoice]);

  // GPX Export Builder
  const handleExportGPX = () => {
    if (coolPath.length === 0) return;
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="CoolRoutePlanner" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Cool Route - ${startName} to ${destName}</name>
    <desc>Heat-optimized pedestrian/cyclist navigation path</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>Coolest Path (Avg Temp: ${routeData.cool_route.avg_temp_c}°C)</name>
    <trkseg>
      ${coolPath.map(pt => `<trkpt lat="${pt[0]}" lon="${pt[1]}"><time>${new Date().toISOString()}</time></trkpt>`).join('\n      ')}
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cool_route_${Date.now()}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Share link
  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Heat Stress & Biometrics calculations
  const healthStats = useMemo(() => {
    if (!routeData) return null;
    const cool = routeData.cool_route;
    const durationHrs = (cool.duration_min || 1) / 60;
    const temp = cool.avg_temp_c || 35;

    const sweatRateMl = Math.round((500 + Math.max(0, temp - 25) * 45) * durationHrs);
    const calPerMin = mode === 'walking' ? 4.5 : mode === 'cycling' ? 7.5 : 2.0;
    const calories = Math.round(calPerMin * cool.duration_min);

    let riskLevel = 'Low';
    let riskColor = '#10b981';
    if (temp > 40) {
      riskLevel = 'Extreme';
      riskColor = '#ef4444';
    } else if (temp > 35) {
      riskLevel = 'High';
      riskColor = '#f97316';
    } else if (temp > 30) {
      riskLevel = 'Moderate';
      riskColor = '#facc15';
    }

    return { sweatRateMl, calories, riskLevel, riskColor, temp };
  }, [routeData, mode]);

  const activeNavPosition = coolPath[navIndex] || coolPath[0] || null;

  return (
    <div className="app-wrapper">
      {/* ══ HEADER ══════════════════════════════════════════════ */}
      <header className="app-header">
        <div className="app-header-brand">
          <div className="brand-logo-glow">
            <Wind size={24} color="#38bdf8" />
          </div>
          <div>
            <div className="brand-title-wrap">
              <h1>Cool Route Planner</h1>
              <span className="pro-pill">PRO HUD</span>
            </div>
            <p className="brand-subtitle">Micro-Climate Routing & Urban Heat Defense</p>
          </div>
        </div>

        <div className="header-actions">
          {/* Time Slider Chip */}
          <div className="timeline-header-widget">
            <span className="widget-label">Thermal Time:</span>
            <div className="time-chips">
              {availableHours.map(h => (
                <button
                  key={h}
                  type="button"
                  className={`time-chip-btn ${selectedHour === h ? 'active' : ''}`}
                  onClick={() => setSelectedHour(h)}
                >
                  {h}
                </button>
              ))}
              <button
                type="button"
                className={`timeline-play-btn ${isPlayingTimeline ? 'playing' : ''}`}
                onClick={() => setIsPlayingTimeline(!isPlayingTimeline)}
                title={isPlayingTimeline ? 'Pause Timeline' : 'Auto Play Heat Evolution'}
              >
                {isPlayingTimeline ? <Pause size={12} /> : <Play size={12} />}
              </button>
            </div>
          </div>

          <div className="header-badges">
            <button className="icon-header-btn" onClick={handleShare} title="Share Route">
              {copiedLink ? <Check size={16} color="#34d399" /> : <Share2 size={16} />}
            </button>
            <span className="header-badge live">
              <span className="live-dot" />
              Live Telemetry
            </span>
          </div>
        </div>
      </header>

      {/* ══ BODY ════════════════════════════════════════════════ */}
      <div className="app-body">

        {/* ── LEFT CONTROL SIDEBAR ── */}
        <aside className="left-panel">

          {/* Route Planning Card */}
          <div className="panel-section glass-card">
            <div className="section-header-row">
              <p className="panel-title">
                <Compass size={15} className="title-icon" /> Route Dispatcher
              </p>
              {activePicking && (
                <span className="picking-banner">Click map to set {activePicking}!</span>
              )}
            </div>

            <form className="route-form" onSubmit={handleCalculateRoute}>
              {/* Origin */}
              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="start-select">Starting Point</label>
                  <button
                    type="button"
                    className={`pick-map-btn ${activePicking === 'start' ? 'active' : ''}`}
                    onClick={() => setActivePicking(activePicking === 'start' ? null : 'start')}
                  >
                    <Crosshair size={12} /> Pick on Map
                  </button>
                </div>
                <div className="input-wrapper">
                  <span className="dot-indicator green"></span>
                  <select
                    id="start-select"
                    className="input-select"
                    value={startName}
                    onChange={(e) => {
                      const poi = PRESET_POIS.find(p => p.name === e.target.value);
                      if (poi) handleSelectPreset('start', poi);
                      else setStartName(e.target.value);
                    }}
                  >
                    {PRESET_POIS.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                    {!PRESET_POIS.some(p => p.name === startName) && (
                      <option value={startName}>{startName}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Swap Button */}
              <div className="swap-row">
                <button type="button" className="swap-btn" onClick={handleSwap} title="Swap Start & Destination">
                  <RefreshCw size={13} />
                </button>
              </div>

              {/* Destination */}
              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="dest-select">Destination</label>
                  <button
                    type="button"
                    className={`pick-map-btn ${activePicking === 'dest' ? 'active' : ''}`}
                    onClick={() => setActivePicking(activePicking === 'dest' ? null : 'dest')}
                  >
                    <Crosshair size={12} /> Pick on Map
                  </button>
                </div>
                <div className="input-wrapper">
                  <span className="dot-indicator red"></span>
                  <select
                    id="dest-select"
                    className="input-select"
                    value={destName}
                    onChange={(e) => {
                      const poi = PRESET_POIS.find(p => p.name === e.target.value);
                      if (poi) handleSelectPreset('dest', poi);
                      else setDestName(e.target.value);
                    }}
                  >
                    {PRESET_POIS.map(p => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                    {!PRESET_POIS.some(p => p.name === destName) && (
                      <option value={destName}>{destName}</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Travel Mode Selector */}
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
                      <span className="mode-text">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Heat Avoidance Alpha Slider */}
              <div className="form-group slider-group">
                <div className="slider-label-row">
                  <span className="slider-title">
                    <Sliders size={12} /> Heat Avoidance Weight
                  </span>
                  <span className="slider-val">{heatTolerance}x (Cool Priority)</span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="10.0"
                  step="0.5"
                  className="pro-range"
                  value={heatTolerance}
                  onChange={(e) => setHeatTolerance(parseFloat(e.target.value))}
                />
                <div className="slider-hints">
                  <span>Fast Direct (1x)</span>
                  <span>Balanced (5x)</span>
                  <span>Max Shade (10x)</span>
                </div>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                className={`submit-btn ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <RefreshCw size={16} className="spin-icon" /> Computing Thermal Gradient…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Calculate Cool Route
                  </>
                )}
              </button>

              {error && (
                <div className="error-msg">
                  <AlertTriangle size={15} />
                  <span>{error}</span>
                </div>
              )}
            </form>
          </div>

          {/* Route Comparison Analytics */}
          {routeData && (
            <div className="panel-section glass-card animate-slide-up">
              <div className="section-header-row">
                <p className="panel-title">
                  <Activity size={15} className="title-icon" /> Route Comparison
                </p>
                <button className="export-gpx-btn" onClick={handleExportGPX} title="Export GPX file for Garmin/Apple Watch">
                  <Download size={13} /> GPX
                </button>
              </div>

              {/* Simulation Navigator Controls */}
              <div className="nav-sim-bar">
                <div className="sim-status">
                  <span className={`sim-indicator ${isNavigating ? 'active' : ''}`} />
                  <span>{isNavigating ? `Navigating (${navIndex + 1}/${coolPath.length})` : 'GPS Route Simulator'}</span>
                </div>
                <div className="sim-actions">
                  <button
                    type="button"
                    className="sim-btn voice"
                    onClick={() => setNavVoice(!navVoice)}
                    title={navVoice ? 'Voice Guidance Enabled' : 'Voice Muted'}
                  >
                    {navVoice ? <Volume2 size={14} color="#38bdf8" /> : <VolumeX size={14} color="#64748b" />}
                  </button>
                  <button
                    type="button"
                    className="sim-btn"
                    onClick={() => { setNavIndex(0); setIsNavigating(false); }}
                    title="Reset Simulation"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    type="button"
                    className={`sim-btn primary ${isNavigating ? 'pause' : 'play'}`}
                    onClick={() => setIsNavigating(!isNavigating)}
                  >
                    {isNavigating ? <Pause size={14} /> : <Play size={14} />}
                    {isNavigating ? 'Pause' : 'Start Walk'}
                  </button>
                </div>
              </div>

              {/* Side-by-side Cards */}
              <div className="route-cards">
                {/* Cool Route */}
                <div className="route-card cool highlight">
                  <div className="route-card-header">
                    <div className="route-title">
                      <TreePine size={16} color="#10b981" />
                      <span>Coolest Corridor</span>
                    </div>
                    <span className="badge cool">Recommended</span>
                  </div>
                  <div className="route-stats-grid">
                    <div className="stat-box">
                      <span className="stat-label">Avg Temp</span>
                      <span className="stat-value cool">{routeData.cool_route.avg_temp_c}°C</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Travel Time</span>
                      <span className="stat-value">{routeData.cool_route.duration_min} min</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Distance</span>
                      <span className="stat-value">{routeData.cool_route.distance_m} m</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Heat Index</span>
                      <span className="stat-value">{routeData.cool_route.heat_exposure_index}</span>
                    </div>
                  </div>
                </div>

                {/* Fastest Hot Route */}
                <div className="route-card hot">
                  <div className="route-card-header">
                    <div className="route-title">
                      <Flame size={16} color="#ef4444" />
                      <span>Direct / High Heat</span>
                    </div>
                    <span className="badge hot">High Exposure</span>
                  </div>
                  <div className="route-stats-grid">
                    <div className="stat-box">
                      <span className="stat-label">Avg Temp</span>
                      <span className="stat-value hot">{routeData.hot_route.avg_temp_c}°C</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Travel Time</span>
                      <span className="stat-value">{routeData.hot_route.duration_min} min</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Distance</span>
                      <span className="stat-value">{routeData.hot_route.distance_m} m</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Heat Index</span>
                      <span className="stat-value">{routeData.hot_route.heat_exposure_index}</span>
                    </div>
                  </div>
                </div>

                {/* Impact Delta Callout */}
                <div className="impact-delta-card">
                  <div className="impact-header">
                    <Zap size={15} color="#38bdf8" />
                    <strong>Thermal Defense Impact</strong>
                  </div>
                  <p>
                    By taking the shaded corridor, you reduce heat exposure by{' '}
                    <strong className="text-emerald">{Math.abs(routeData.exposure_reduction_pct)}%</strong>{' '}
                    with only <strong className="text-amber">{routeData.extra_distance_m} m</strong> detour.
                  </p>
                </div>
              </div>

              {/* Health & Hydration Biometrics */}
              {healthStats && (
                <div className="health-hud-section">
                  <div className="health-hud-title">
                    <ShieldCheck size={14} color="#10b981" /> Biometric & Health Advisories
                  </div>
                  <div className="health-grid">
                    <div className="health-card">
                      <Droplets size={16} color="#38bdf8" />
                      <div>
                        <span className="health-val">{healthStats.sweatRateMl} ml</span>
                        <span className="health-lbl">Est. Fluid Loss</span>
                      </div>
                    </div>
                    <div className="health-card">
                      <Sun size={16} color="#f59e0b" />
                      <div>
                        <span className="health-val" style={{ color: healthStats.riskColor }}>
                          {healthStats.riskLevel}
                        </span>
                        <span className="health-lbl">Heat Stress Risk</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cooling Oasis Quick List */}
          <div className="panel-section glass-card">
            <p className="panel-title">
              <Snowflake size={15} className="title-icon" /> Shaded Cooling Stops ({coolStops.length})
            </p>
            <div className="cooling-stops-list">
              {coolStops.map((stop, idx) => (
                <div
                  key={idx}
                  className="cooling-stop-item"
                  onClick={() => {
                    handleSelectPreset('dest', { name: `Cooling Oasis #${idx + 1}`, lat: stop.lat, lon: stop.lon });
                  }}
                  title="Click to set as destination"
                >
                  <div className="stop-icon-col">❄️</div>
                  <div className="stop-info-col">
                    <div className="stop-name">Cooling Station #{idx + 1}</div>
                    <div className="stop-details">
                      Ambient: <strong className="text-sky">{stop.temp_c?.toFixed(1)}°C</strong> · Shaded Rest Oasis
                    </div>
                  </div>
                  <ArrowRight size={14} className="stop-arrow" />
                </div>
              ))}
            </div>
          </div>

        </aside>

        {/* ── RIGHT MAP CANVAS ── */}
        <main className="right-panel">
          <div className="map-container-wrapper">

            {/* Top Interactive HUD */}
            <div className="map-top-bar">
              <div className="map-chip-pro">
                <span className="chip-indicator" />
                <div>
                  <strong>Las Vegas Thermal Corridor</strong>
                  <span>AOI: 36.11°N, 115.17°W · AI Grid ({heatPts.length} sensors)</span>
                </div>
              </div>

              <div className="map-controls-row">
                <div className="basemap-select-group">
                  <Layers size={14} />
                  {Object.entries(BASEMAPS).map(([key, bm]) => (
                    <button
                      key={key}
                      type="button"
                      className={`bm-btn ${basemapKey === key ? 'active' : ''}`}
                      onClick={() => setBasemapKey(key)}
                    >
                      {bm.icon} {bm.name}
                    </button>
                  ))}
                </div>

                <div className="toggle-group">
                  <button
                    type="button"
                    className={`toggle-btn ${showHeatmap ? 'active' : ''}`}
                    onClick={() => setShowHeatmap(!showHeatmap)}
                  >
                    <Flame size={13} /> Thermal Layer
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${showCoolingStops ? 'active' : ''}`}
                    onClick={() => setShowCoolingStops(!showCoolingStops)}
                  >
                    <Snowflake size={13} /> Cooling Stops
                  </button>
                </div>
              </div>
            </div>

            {/* Leaflet Map React Engine */}
            <MapContainer
              center={MAP_CENTER}
              zoom={14}
              scrollWheelZoom={true}
              className={`leaflet-map-canvas ${BASEMAPS[basemapKey].cssClass || ''}`}
            >
              <TileLayer
                url={BASEMAPS[basemapKey].base}
                attribution={BASEMAPS[basemapKey].attribution}
                subdomains={BASEMAPS[basemapKey].subdomains || []}
                maxZoom={BASEMAPS[basemapKey].maxZoom}
              />

              {BASEMAPS[basemapKey].ref && (
                <TileLayer url={BASEMAPS[basemapKey].ref} maxZoom={BASEMAPS[basemapKey].maxZoom} />
              )}

              <MapClickHandler activePicking={activePicking} onLocationPicked={handleLocationPicked} />
              <MapViewController bounds={routeBounds} />

              {/* Heatmap Overlay */}
              {showHeatmap && <HeatmapLayer points={heatPts} intensity={1.2} />}

              {/* Cooling Oasis Markers */}
              {showCoolingStops && coolStops.map((stop, idx) => (
                <Marker key={idx} position={[stop.lat, stop.lon]} icon={CoolingIcon}>
                  <Popup>
                    <div className="popup-box">
                      <h4>❄️ Shaded Cooling Oasis</h4>
                      <p>Temp: <strong>{stop.temp_c?.toFixed(1)}°C</strong></p>
                      <small>Resting zone equipped with misting & shade canopy.</small>
                    </div>
                  </Popup>
                </Marker>
              ))}

              {/* Origin Marker */}
              {startCoords && (
                <Marker position={[startCoords.lat, startCoords.lon]} icon={StartIcon}>
                  <Popup>
                    <div className="popup-box">
                      <h4>🟢 Origin</h4>
                      <p>{startName}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Destination Marker */}
              {destCoords && (
                <Marker position={[destCoords.lat, destCoords.lon]} icon={DestIcon}>
                  <Popup>
                    <div className="popup-box">
                      <h4>🏁 Destination</h4>
                      <p>{destName}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Hot / Direct Path Polyline */}
              {hotPath.length > 0 && (
                <Polyline
                  positions={hotPath}
                  pathOptions={{
                    color: '#ef4444',
                    weight: 4,
                    dashArray: '6, 8',
                    opacity: 0.7,
                  }}
                />
              )}

              {/* Cool / Shaded Path Polyline */}
              {coolPath.length > 0 && (
                <Polyline
                  positions={coolPath}
                  pathOptions={{
                    color: '#10b981',
                    weight: 6,
                    opacity: 0.95,
                  }}
                />
              )}

              {/* Live Navigation Marker */}
              {isNavigating && activeNavPosition && (
                <Marker position={activeNavPosition} icon={SimNavIcon} />
              )}
            </MapContainer>
          </div>
        </main>

      </div>
    </div>
  );
}
