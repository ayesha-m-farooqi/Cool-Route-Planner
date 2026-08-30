"""
diagnose_routing.py
Run this once to understand WHY hot_route and cool_route keep coming out
identical, instead of guessing at more coordinate pairs.

It answers two separate questions:
  1. Does a genuinely DIFFERENT street path even exist between these two
     points? (a connectivity question)
  2. If alternate paths exist, do they actually have different average
     temperatures? (a data-resolution question)

Run with the SAME ORIGIN/DESTINATION you just tested.
"""

import json
import itertools
import networkx as nx
import osmnx as ox
from routing_engine import TemperatureLookup, attach_temperatures, build_street_graph

VEGAS_AOI = [
    [-115.2000, 36.0950],
    [-115.1400, 36.0950],
    [-115.1400, 36.1800],
    [-115.2000, 36.1800],
    [-115.2000, 36.0950],
]

ORIGIN = (36.1087, -115.1777)
DESTINATION = (36.1150, -115.1742)

temp_lookup = TemperatureLookup("vegas_heatmap.geojson")
G = build_street_graph(VEGAS_AOI, mode="walk")
G = attach_temperatures(G, temp_lookup)

orig = ox.distance.nearest_nodes(G, ORIGIN[1], ORIGIN[0])
dest = ox.distance.nearest_nodes(G, DESTINATION[1], DESTINATION[0])


def to_simple_digraph(G):
    """
    nx.shortest_simple_paths (Yen's algorithm) doesn't support MultiDiGraphs.
    Collapse parallel edges into a plain DiGraph, keeping whichever parallel
    edge is shortest between each pair of nodes (matching how NetworkX
    itself resolves multigraphs for string weights).
    """
    H = nx.DiGraph()
    H.add_nodes_from(G.nodes(data=True))
    for u, v, data in G.edges(data=True):
        if H.has_edge(u, v):
            if data.get("length", float("inf")) < H[u][v].get("length", float("inf")):
                H[u][v].update(data)
        else:
            H.add_edge(u, v, **data)
    return H


H = to_simple_digraph(G)

print("\n=== QUESTION 1: Do alternate paths even exist? ===")
# Yen's algorithm: enumerate the first few shortest paths by distance,
# not just the single best one.
path_gen = nx.shortest_simple_paths(H, orig, dest, weight="length")
paths = list(itertools.islice(path_gen, 5))
print(f"Found {len(paths)} distinct candidate paths (showing up to 5).")

if len(paths) <= 1:
    print(">>> CONCLUSION: There is only ONE viable street path between these")
    print(">>> two points in this graph. No alternate route exists to weigh")
    print(">>> against - the router has nothing to choose between, regardless")
    print(">>> of temperature. This is a street-network connectivity limit,")
    print(">>> not a bug in the heat-weighting logic.")
else:
    print("\n=== QUESTION 2: Do those alternate paths actually differ in temperature? ===")
    for idx, path in enumerate(paths):
        edge_lengths = [H[path[i]][path[i+1]].get("length", 0) for i in range(len(path)-1)]
        edge_temps = [H[path[i]][path[i+1]].get("temp_c", 0) for i in range(len(path)-1)]
        dist = sum(edge_lengths)
        avg_temp = sum(t*l for t, l in zip(edge_temps, edge_lengths)) / dist if dist else 0
        print(f"Path {idx+1}: distance={dist:.0f}m  avg_temp={avg_temp:.3f}C  "
              f"min_edge_temp={min(edge_temps):.3f}  max_edge_temp={max(edge_temps):.3f}")

    temps_across_paths = []
    for path in paths:
        edge_lengths = [H[path[i]][path[i+1]].get("length", 0) for i in range(len(path)-1)]
        edge_temps = [H[path[i]][path[i+1]].get("temp_c", 0) for i in range(len(path)-1)]
        dist = sum(edge_lengths)
        avg_temp = sum(t*l for t, l in zip(edge_temps, edge_lengths)) / dist if dist else 0
        temps_across_paths.append(avg_temp)

    spread = max(temps_across_paths) - min(temps_across_paths)
    print(f"\nSpread in avg_temp ACROSS these alternate paths: {spread:.4f}C")
    if spread < 0.05:
        print(">>> CONCLUSION: Alternate paths exist, but they all have nearly")
        print(">>> identical average temperature. At this network's resolution,")
        print(">>> parallel streets in this local area don't meaningfully differ")
        print(">>> in temperature - the FortyGuard tiles vary more at a broader")
        print(">>> neighborhood scale than at a single-block, street-to-street scale.")
    else:
        print(">>> CONCLUSION: Real temperature variation DOES exist among these")
        print(">>> alternate paths. If your cool_route still isn't picking the")
        print(">>> cooler one, the alpha value likely needs to be increased further.")
