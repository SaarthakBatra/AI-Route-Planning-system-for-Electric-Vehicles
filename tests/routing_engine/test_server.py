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
META_REAL  = [('use-real-algo', 'true')]   # gRPC metadata to request Stage 2 algorithm
META_DUMMY = []                             # No metadata = Stage 1 DUMMY_TRACER (default)

# ─── Fixture ──────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def grpc_server():
    """
    Starts a gRPC server in a background thread for the duration of the test module.

    IMPORTANT: Do NOT run `python server.py` before running tests.
    This fixture manages the server lifecycle automatically.
    If port 50051 is already occupied, the fixture will raise an explicit error
    to prevent silent cross-process metadata isolation failures.
    """
    # ── Port conflict guard ───────────────────────────────────────────────────
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        port_in_use = probe.connect_ex(('localhost', GRPC_PORT)) == 0

    if port_in_use:
        pytest.fail(
            f"\n\n[ERROR] test_server.py | Port {GRPC_PORT} is already occupied by an external process.\n"
            f"        Most likely cause: 'python server.py' is running in another terminal.\n"
            f"        Fix: Stop the external server (Ctrl+C) and re-run the tests.\n"
            f"        Tests manage the server lifecycle automatically — no manual server needed.\n"
        )

    print(f"\n[DEBUG] test_server.py | Port {GRPC_PORT} is free. Starting in-process gRPC server.")
    thread = threading.Thread(target=serve)
    thread.daemon = True
    thread.start()
    time.sleep(1.5)  # Allow server to bind and become ready
    print("[DEBUG] test_server.py | gRPC server is ready.")
    yield
    print("[DEBUG] test_server.py | Tearing down test gRPC server.")


# ─── Helper ───────────────────────────────────────────────────────────────────
def make_stub():
    """Returns a fresh gRPC stub for each test call."""
    channel = grpc.insecure_channel(f'localhost:{GRPC_PORT}')
    return route_engine_pb2_grpc.RouteServiceStub(channel)


# ─── Stage 1 Test (Preserved) ─────────────────────────────────────────────────
def test_calculate_route_tracer_bullet(grpc_server):
    """Stage 1: Verifies the original dummy tracer bullet still works."""
    print("\n[DEBUG] test_calculate_route_tracer_bullet | Input: Dispatching dummy request (no metadata = DUMMY mode)")
    stub = make_stub()

    req = route_engine_pb2.RouteRequest()
    req.start.lat = 34.0522
    req.start.lng = -118.2437
    req.end.lat   = 36.1699
    req.end.lng   = -115.1398

    # No metadata → server defaults to DUMMY_TRACER (Stage 1)
    response = stub.CalculateRoute(req, metadata=META_DUMMY)
    print(f"[DEBUG] test_calculate_route_tracer_bullet | Output: {len(response.polyline)} nodes | dist={response.distance}m | dur={response.duration}s")

    assert len(response.polyline) == 4
    assert response.distance == 15000.0
    assert response.duration == 1800.0


# ─── Stage 2 Tests (Dijkstra) ─────────────────────────────────────────────────
def test_calculate_route_real_dijkstra(grpc_server):
    """Stage 2: Verifies Dijkstra finds a valid Pilani→Jaipur path."""
    print("\n[DEBUG] test_calculate_route_real_dijkstra | Input: Pilani→Jaipur (metadata=REAL mode)")
    stub = make_stub()

    req = route_engine_pb2.RouteRequest()
    req.start.lat = 28.3623
    req.start.lng = 75.6042
    req.end.lat   = 26.9784
    req.end.lng   = 75.7122

    # Metadata header → server uses Stage 2 Dijkstra. Process-independent.
    response = stub.CalculateRoute(req, metadata=META_REAL)
    print(f"[DEBUG] test_calculate_route_real_dijkstra | Output: {len(response.polyline)} nodes | dist={response.distance:.1f}m | dur={response.duration:.1f}s")

    # Path: at least 8 nodes (shortest Narnaul corridor has 8)
    assert len(response.polyline) >= 8
    # Distance: Haversine-sum ~199–230km for any valid corridor
    assert 190000 < response.distance < 250000
    # Duration: ~2.5–7h in seconds via MoRTH speeds
    assert 7200 < response.duration < 25000
    # Start snapped to Pilani (node 0: 28.3623, 75.6042)
    assert round(response.polyline[0].lat, 4) == 28.3623
    # End snapped to Jaipur (node 7: 26.9784, 75.7122)
    assert round(response.polyline[-1].lat, 4) == 26.9784


def test_dijkstra_bidirectional(grpc_server):
    """Stage 2: Verifies Dijkstra works in the reverse direction (Jaipur→Pilani)."""
    print("\n[DEBUG] test_dijkstra_bidirectional | Input: Jaipur→Pilani (metadata=REAL mode)")
    stub = make_stub()

    req = route_engine_pb2.RouteRequest()
    req.start.lat = 26.9784
    req.start.lng = 75.7122
    req.end.lat   = 28.3623
    req.end.lng   = 75.6042

    response = stub.CalculateRoute(req, metadata=META_REAL)
    print(f"[DEBUG] test_dijkstra_bidirectional | Output: {len(response.polyline)} nodes | dist={response.distance:.1f}m")

    assert len(response.polyline) >= 8
    assert round(response.polyline[0].lat, 4) == 26.9784
    assert round(response.polyline[-1].lat, 4) == 28.3623


def test_dijkstra_nearest_node_snap(grpc_server):
    """Stage 2: Verifies off-graph coordinates are snapped to the nearest node (Pilani)."""
    print("\n[DEBUG] test_dijkstra_nearest_node_snap | Input: (28.3600, 75.6000) → slightly south of Pilani")
    stub = make_stub()

    req = route_engine_pb2.RouteRequest()
    req.start.lat = 28.3600  # ~366m south of Pilani node
    req.start.lng = 75.6000  # ~390m west of Pilani node
    req.end.lat   = 26.9784
    req.end.lng   = 75.7122

    response = stub.CalculateRoute(req, metadata=META_REAL)
    print(f"[DEBUG] test_dijkstra_nearest_node_snap | Output: start snapped to ({response.polyline[0].lat}, {response.polyline[0].lng})")

    # C++ find_nearest_node() must snap (28.36, 75.60) → Pilani (28.3623, 75.6042)
    assert round(response.polyline[0].lat, 4) == 28.3623
    assert round(response.polyline[0].lng, 4) == 75.6042
