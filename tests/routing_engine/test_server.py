import sys
import os
import socket
import threading
import time
import pytest
import grpc

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/proto')))

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
    from server import serve
except ImportError:
    pytest.skip("Skipping tests as protos or C++ build bindings not found. Run setup steps first.", allow_module_level=True)

# ─── Constants ────────────────────────────────────────────────────────────────
GRPC_PORT = 50051
META_DEBUG = [('debug-mode', 'true')]   # gRPC metadata to request Stage 1 tracer
META_REAL  = []                           # Default = Step 3 Parallel Suite

# ─── Fixture ──────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def grpc_server():
    """
    Starts a gRPC server in a background thread for the duration of the test module.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        port_in_use = probe.connect_ex(('localhost', GRPC_PORT)) == 0

    if port_in_use:
        pytest.fail(f"Port {GRPC_PORT} already in use.")

    print(f"\n[DEBUG] test_server.py | Starting gRPC server.")
    thread = threading.Thread(target=serve)
    thread.daemon = True
    thread.start()
    time.sleep(2.0)
    yield
    print("[DEBUG] test_server.py | Tearing down.")

def make_stub():
    channel = grpc.insecure_channel(f'localhost:{GRPC_PORT}')
    return route_engine_pb2_grpc.RouteServiceStub(channel)

# ─── Tests ────────────────────────────────────────────────────────────────────

def test_debug_mode_tracer(grpc_server):
    """Verifies debug-mode: true still returns the legacy dummy route."""
    print("\n[DEBUG] test_debug_mode_tracer | Input: debug-mode=true")
    stub = make_stub()
    req = route_engine_pb2.RouteRequest()
    req.start.lat, req.start.lng = 28.3623, 75.6042
    req.end.lat, req.end.lng = 26.9784, 75.7122

    response = stub.CalculateRoute(req, metadata=META_DEBUG)
    assert len(response.results) == 1
    assert response.results[0].algorithm == "DUMMY_TRACER"
    assert len(response.results[0].polyline) == 4

def test_parallel_academic_suite(grpc_server):
    """Verifies that 5 algorithms are returned by default."""
    print("\n[DEBUG] test_parallel_academic_suite | Input: Default (Step 3)")
    stub = make_stub()
    req = route_engine_pb2.RouteRequest()
    req.start.lat, req.start.lng = 28.3623, 75.6042
    req.end.lat, req.end.lng = 26.9784, 75.7122
    req.mock_hour = 12 # Non-peak
    req.objective = route_engine_pb2.FASTEST

    response = stub.CalculateRoute(req, metadata=META_REAL)
    
    # Assert 5 algorithms returned
    algos = [res.algorithm for res in response.results]
    expected_algos = ["BFS", "Dijkstra", "IDDFS", "A*", "IDA*"]
    for expected in expected_algos:
        assert expected in algos

    for res in response.results:
        print(f" -> Testing {res.algorithm}: {len(res.polyline)} nodes, {res.exec_time_ms:.2f}ms")
        assert len(res.polyline) >= 2
        assert res.nodes_expanded > 0
        assert res.exec_time_ms >= 0
        assert res.distance > 0

def test_mock_traffic_impact(grpc_server):
    """Verifies that changing mock_hour affects the duration."""
    stub = make_stub()
    
    # Non-peak hour (12 PM)
    req_midday = route_engine_pb2.RouteRequest()
    req_midday.start.lat, req_midday.start.lng = 28.3623, 75.6042
    req_midday.end.lat, req_midday.end.lng = 26.9784, 75.7122
    req_midday.mock_hour = 12
    req_midday.objective = route_engine_pb2.FASTEST
    res_midday = stub.CalculateRoute(req_midday, metadata=META_REAL)
    dijkstra_midday = next(r for r in res_midday.results if r.algorithm == "Dijkstra")

    # Peak hour (8 AM)
    req_peak = route_engine_pb2.RouteRequest()
    req_peak.start.lat, req_peak.start.lng = 28.3623, 75.6042
    req_peak.end.lat, req_peak.end.lng = 26.9784, 75.7122
    req_peak.mock_hour = 8
    req_peak.objective = route_engine_pb2.FASTEST
    res_peak = stub.CalculateRoute(req_peak, metadata=META_REAL)
    dijkstra_peak = next(r for r in res_peak.results if r.algorithm == "Dijkstra")

    print(f"\n[DEBUG] Traffic Check | Midday: {dijkstra_midday.duration:.1f}s | Peak: {dijkstra_peak.duration:.1f}s")
    
    # Peak duration should be significantly longer due to multipliers
    assert dijkstra_peak.duration > dijkstra_midday.duration

def test_objective_comparison(grpc_server):
    """Verifies that SHORTEST vs FASTEST objectives can yield different path costs."""
    stub = make_stub()
    
    # Fastest (Duration)
    req_fast = route_engine_pb2.RouteRequest()
    req_fast.start.lat, req_fast.start.lng = 28.3623, 75.6042
    req_fast.end.lat, req_fast.end.lng = 26.9784, 75.7122
    req_fast.mock_hour = 8 # Peak hour for more variation
    req_fast.objective = route_engine_pb2.FASTEST
    res_fast = stub.CalculateRoute(req_fast, metadata=META_REAL)
    a_star_fast = next(r for r in res_fast.results if r.algorithm == "A*")

    # Shortest (Distance)
    req_short = route_engine_pb2.RouteRequest()
    req_short.start.lat, req_short.start.lng = 28.3623, 75.6042
    req_short.end.lat, req_short.end.lng = 26.9784, 75.7122
    req_short.mock_hour = 8
    req_short.objective = route_engine_pb2.SHORTEST
    res_short = stub.CalculateRoute(req_short, metadata=META_REAL)
    a_star_short = next(r for r in res_short.results if r.algorithm == "A*")

    print(f"\n[DEBUG] Objective Check | Fastest Cost (s): {a_star_fast.path_cost:.1f} | Shortest Cost (m): {a_star_short.path_cost:.1f}")
    assert a_star_fast.path_cost != a_star_short.path_cost
def test_dynamic_map_data_ingestion(grpc_server):
    """Verifies that the server can ingest dynamic OSM JSON and route on it."""
    print("\n[DEBUG] test_dynamic_map_data_ingestion | Input: Mocked OSM JSON")
    stub = make_stub()
    
    # Mock OSM JSON for a simple square (4 nodes, 4 ways)
    mock_osm = {
        "elements": [
            {"type": "node", "id": 1, "lat": 51.500, "lon": -0.100},
            {"type": "node", "id": 2, "lat": 51.501, "lon": -0.100},
            {"type": "node", "id": 3, "lat": 51.501, "lon": -0.099},
            {"type": "node", "id": 4, "lat": 51.500, "lon": -0.099},
            {"type": "way", "id": 101, "nodes": [1, 2], "tags": {"highway": "primary", "maxspeed": "50"}},
            {"type": "way", "id": 102, "nodes": [2, 3], "tags": {"highway": "primary", "maxspeed": "50"}},
            {"type": "way", "id": 103, "nodes": [3, 4], "tags": {"highway": "primary", "maxspeed": "50"}},
            {"type": "way", "id": 104, "nodes": [4, 1], "tags": {"highway": "primary", "maxspeed": "50"}}
        ]
    }
    
    req = route_engine_pb2.RouteRequest()
    req.start.lat, req.start.lng = 51.500, -0.100
    req.end.lat, req.end.lng = 51.501, -0.099
    req.mock_hour = 12
    req.objective = route_engine_pb2.FASTEST
    req.map_data = json.dumps(mock_osm)

    response = stub.CalculateRoute(req, metadata=META_REAL)
    
    assert len(response.results) == 5
    for res in response.results:
        # Should find a path in the 4-node square
        assert len(res.polyline) >= 2
        print(f" -> Dynamic {res.algorithm}: {len(res.polyline)} nodes")

import json
