import json
import numpy as np
import pandas as pd
import networkx as nx
from datetime import datetime, timezone
from db import get_conn
from ontology import COUNTRY_METADATA

CHANNEL_LABELS = {
    "financial": "financial",
    "trade": "trade",
    "regional": "political",
}

DAMPENING = 0.6
MAX_HOPS = 2
MIN_EDGE_WEIGHT = 0.30


def build_contagion_graph(
    countries: list,
    correlations: pd.DataFrame,
) -> nx.DiGraph:
    G = nx.DiGraph()

    iso3_list = [c.iso3 for c in countries]
    G.add_nodes_from(iso3_list)

    region_map = {c.iso3: c.region for c in countries}
    trade_map = {c.iso3: (c.trade_openness or 0.0) for c in countries}

    trade_values = list(trade_map.values())
    t_min, t_max = min(trade_values), max(trade_values)
    t_range = t_max - t_min if t_max != t_min else 1.0

    def norm_trade(iso3: str) -> float:
        return (trade_map.get(iso3, 0.0) - t_min) / t_range

    for i, iso_a in enumerate(iso3_list):
        for iso_b in iso3_list:
            if iso_a == iso_b:
                continue

            fin_corr = 0.0
            if not correlations.empty:
                mask = (
                    ((correlations["country_a"] == iso_a) & (correlations["country_b"] == iso_b)) |
                    ((correlations["country_a"] == iso_b) & (correlations["country_b"] == iso_a))
                )
                matched = correlations[mask]
                if not matched.empty:
                    fin_corr = abs(float(matched.iloc[-1]["correlation_30d"]))

            fin_component = 0.5 * fin_corr
            trade_component = 0.3 * norm_trade(iso_b)
            regional_component = 0.2 * int(region_map.get(iso_a) == region_map.get(iso_b))

            weight = fin_component + trade_component + regional_component

            if weight < MIN_EDGE_WEIGHT:
                continue

            # Classify channel by dominant component
            components = {
                "financial": fin_component,
                "trade": trade_component,
                "political": regional_component,
            }
            channel = max(components, key=components.get)

            G.add_edge(iso_a, iso_b, weight=weight, channel=channel)

    return G


def propagate_shock(graph: nx.DiGraph, epicenter_iso3: str, shock_magnitude: float) -> dict[str, float]:
    results: dict[str, float] = {}

    if epicenter_iso3 not in graph:
        return results

    # BFS up to MAX_HOPS hops with dampening
    frontier = {epicenter_iso3: shock_magnitude}

    for hop in range(MAX_HOPS):
        next_frontier: dict[str, float] = {}
        for source, incoming_shock in frontier.items():
            for target in graph.successors(source):
                if target == epicenter_iso3:
                    continue
                edge_weight = graph[source][target]["weight"]
                transmitted = incoming_shock * DAMPENING * edge_weight
                if transmitted < 0.5:
                    continue
                next_frontier[target] = max(next_frontier.get(target, 0), transmitted)
        results.update(next_frontier)
        frontier = next_frontier

    return results


def run() -> nx.DiGraph:
    conn = get_conn()
    now = datetime.now(timezone.utc)

    from ontology import hydrate_countries
    countries = hydrate_countries(conn)

    corr_rows = conn.execute(
        """
        SELECT country_a, country_b, correlation_30d
        FROM correlations
        WHERE date = (SELECT MAX(date) FROM correlations)
        """
    ).fetchall()
    correlations = pd.DataFrame(corr_rows, columns=["country_a", "country_b", "correlation_30d"])

    G = build_contagion_graph(countries, correlations)

    rows_written = 0
    for src, dst, data in G.edges(data=True):
        conn.execute(
            """
            INSERT INTO contagion_edges (source_country, target_country, transmission_weight, channel, computed_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [src, dst, float(data["weight"]), data["channel"], now],
        )
        rows_written += 1

    return G


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    G = run()
    edges = sorted(G.edges(data=True), key=lambda e: e[2]["weight"], reverse=True)
    print(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    print("Top 10 edges by transmission weight:")
    for src, dst, d in edges[:10]:
        print(f"  {src} → {dst}: {d['weight']:.3f} ({d['channel']})")
