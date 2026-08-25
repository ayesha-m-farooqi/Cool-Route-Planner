"""
scan_best_routes.py
Instead of manually guessing coordinate pairs one at a time, this samples
many random origin/destination pairs across the whole AOI, computes hot vs
cool routes for each, and ranks them by actual heat_reduction_pct.

This answers the real open question directly: does ANY pair in this
dataset show a meaningful cool-route benefit, and if so, where?

Run this once. It will take a while (one shortest-path computation per
pair) but only needs to run once to tell the whole team whether the
"avoid the hot street" concept has real demo material anywhere in Vegas,
or whether the pitch should lean on time-of-day / cooling-stops instead.
"""

import random
import json
import networkx as nx
import osmnx as ox
from routing_engine import (
    TemperatureLookup,
    build_street_graph,
    attach_temperatures,
    get_hot_and_cool_routes,
)

VEGAS_AOI = [
    [-115.2000, 36.0950],
    [-115.1400, 36.0950],
    [-115.1400, 36.1800],
    [-115.2000, 36.1800],
    [-115.2000, 36.0950],
]

NUM_SAMPLES = 60         # how many random pairs to try
MIN_DIST_M = 400         # ignore pairs that are trivially short
MAX_DIST_M = 3000        # keep pairs at a realistic walking/biking scale
ALPHA = 6.0
MODE = "walk"

random.seed(42)  # reproducible results

temp_lookup = TemperatureLookup("vegas_heatmap.geojson")
G = build_street_graph(VEGAS_AOI, mode=MODE)
G = attach_temperatures(G, temp_lookup)

nodes = list(G.nodes)
results = []

print(f"\nSampling {NUM_SAMPLES} random pairs of nodes...")
attempts = 0
while len(results) < NUM_SAMPLES and attempts < NUM_SAMPLES * 10:
    attempts += 1
    orig, dest = random.sample(nodes, 2)
    try:
        res = get_hot_and_cool_routes(G, orig, dest, alpha=ALPHA, mode=MODE)
    except nx.NetworkXNoPath:
        continue

    dist = res["hot_route"]["distance_m"]
    if dist < MIN_DIST_M or dist > MAX_DIST_M:
        continue

    results.append({
        "orig_latlon": (G.nodes[orig]["y"], G.nodes[orig]["x"]),
        "dest_latlon": (G.nodes[dest]["y"], G.nodes[dest]["x"]),
        "distance_m": dist,
        "heat_reduction_pct": res["heat_reduction_pct"],
        "exposure_reduction_pct": res["exposure_reduction_pct"],
        "extra_distance_m": res["extra_distance_m"],
    })

results.sort(key=lambda r: (r["heat_reduction_pct"] or 0), reverse=True)

print(f"\nCollected {len(results)} valid pairs (400m-3000m apart). Top 10 by heat reduction:\n")
for r in results[:10]:
    print(
        f"  reduction={r['heat_reduction_pct']}%  "
        f"exposure_reduction={r['exposure_reduction_pct']}%  "
        f"dist={r['distance_m']:.0f}m  extra={r['extra_distance_m']:.0f}m  "
        f"orig={r['orig_latlon']}  dest={r['dest_latlon']}"
    )

best = results[0] if results else None
print("\n=== VERDICT ===")
if best and (best["heat_reduction_pct"] or 0) > 1.0:
    print(f"Found at least one pair with a real, meaningful benefit "
          f"({best['heat_reduction_pct']}% reduction). Use this pair for the demo:")
    print(f"  ORIGIN = {best['orig_latlon']}")
    print(f"  DESTINATION = {best['dest_latlon']}")
else:
    print("No sampled pair showed a meaningful heat reduction (>1%) within a")
    print("realistic 400m-3000m walking/biking distance. This is consistent")
    print("with what earlier tests found: at this data resolution, street-to-")
    print("street temperature variation within a short walkable distance is minimal")

with open("route_scan_results.json", "w") as f:
    json.dump(results, f, indent=2)
print("\nFull results saved to route_scan_results.json")
