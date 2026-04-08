import sys
import os
import unittest
import time
import grpc
import pytest
import socket
import threading

# Ensure we can import the generated protos
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine')))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/proto')))

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
    from server import serve
except ImportError:
    print("Error: Protos not found. Please compile them first.")
    sys.exit(1)

# --- Fixture ---
@pytest.fixture(scope="module")
def grpc_server():
    """Starts a gRPC server in a background thread."""
    port = 50051
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex(('localhost', port)) == 0:
            yield # Already running
            return

    thread = threading.Thread(target=serve)
    thread.daemon = True
    thread.start()
    time.sleep(2.0)
    yield

def make_stub():
    max_msg_size = 100 * 1024 * 1024
    options = [
        ('grpc.max_send_message_length', max_msg_size),
        ('grpc.max_receive_message_length', max_msg_size)
    ]
    channel = grpc.insecure_channel('localhost:50051', options=options)
    return route_engine_pb2_grpc.RouteServiceStub(channel)

def test_standard_charging_expansion(grpc_server):
    """
    Verifies that a path is forced to charge if the target is unreachable otherwise.
    """
    stub = make_stub()
    payload = route_engine_pb2.MapPayload()
    n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng = 0, 40.0, -70.0
    n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 1, 40.9, -70.0 # ~100km North
    n1.is_charger = True
    n1.kw_output = 50.0
    n1.is_operational = True
    
    n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng = 2, 41.8, -70.0 # ~100km further North
    
    e1 = payload.edges.add(); e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, 1, 100000.0, 100
    e2 = payload.edges.add(); e2.u, e2.v, e2.weight_m, e2.speed_kmh = 1, 2, 100000.0, 100
    
    ev_params = route_engine_pb2.EVParams()
    ev_params.enabled = True
    ev_params.start_soc_kwh = 30.0
    ev_params.min_arrival_soc_kwh = 5.0
    ev_params.target_charge_bound_kwh = 60.0 # Charge to 60kWh
    
    request = route_engine_pb2.RouteRequest()
    request.start.lat, request.start.lng = 40.0, -70.0
    request.end.lat, request.end.lng = 41.8, -70.0
    request.map_data_pb = payload.SerializeToString()
    request.ev_params.CopyFrom(ev_params)
    
    response = stub.CalculateRoute(request)
    
    for res in response.results:
        if res.algorithm in ["IDDFS", "IDA*"]: continue
        assert len(res.polyline) > 2
        has_stop = any(p.segment_consumed_kwh < 0 for p in res.polyline)
        assert has_stop, f"Algorithm {res.algorithm} failed to include a charging stop."
        print(f"[CHARGING] {res.algorithm} Stop: Verified. Arrival SoC: {res.arrival_soc_kwh:.2f}kWh")

def test_default_charging_powers(grpc_server):
    """Verifies 50kW standard and 3kW emergency defaults (v2.5.0)."""
    stub = make_stub()
    payload = route_engine_pb2.MapPayload()
    n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng = 0, 0, 0
    n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 1, 0.001, 0.001
    n1.is_charger = True
    n1.kw_output = 0.0 # Force default
    n1.is_operational = True
    
    e = payload.edges.add(); e.u, e.v, e.weight_m, e.speed_kmh = 0, 1, 100, 50
    
    ev_params = route_engine_pb2.EVParams()
    ev_params.enabled = True
    ev_params.start_soc_kwh = 1.0
    ev_params.min_arrival_soc_kwh = 5.0 # Force charge to reach reserve
    ev_params.target_charge_bound_kwh = 10.0
    
    request = route_engine_pb2.RouteRequest()
    request.start.lat, request.start.lng = 0, 0
    request.end.lat, request.end.lng = 0.001, 0.001
    request.map_data_pb = payload.SerializeToString()
    request.ev_params.CopyFrom(ev_params)
    
    # 1. Standard Default (50kW)
    n1.is_emergency_assumption = False
    request.map_data_pb = payload.SerializeToString()
    res_std = stub.CalculateRoute(request)
    dijkstra_std = next(r for r in res_std.results if r.algorithm == "Dijkstra")
    
    # 2. Emergency Default (3kW)
    n1.is_emergency_assumption = True
    request.map_data_pb = payload.SerializeToString()
    res_emg = stub.CalculateRoute(request)
    dijkstra_emg = next(r for r in res_emg.results if r.algorithm == "Dijkstra")
    
    print(f"[POWER] Standard Time: {dijkstra_std.duration:.1f}s | Emergency Time: {dijkstra_emg.duration:.1f}s")
    assert dijkstra_emg.duration > dijkstra_std.duration * 10
