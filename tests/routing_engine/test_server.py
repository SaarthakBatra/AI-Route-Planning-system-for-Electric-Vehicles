import sys
import os
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

@pytest.fixture(scope="module")
def grpc_server():
    print("\n[DEBUG] test_server.py | Starting test gRPC server in background thread")
    thread = threading.Thread(target=serve)
    thread.daemon = True
    thread.start()
    time.sleep(1.5) # Allow server to bind to port
    yield
    print("[DEBUG] test_server.py | Tearing down test gRPC server")

def test_calculate_route_tracer_bullet(grpc_server):
    print("[DEBUG] test_calculate_route_tracer_bullet | Input: Dispatching dummy request via gRPC channel")
    
    channel = grpc.insecure_channel('localhost:50051')
    stub = route_engine_pb2_grpc.RouteServiceStub(channel)
    
    req = route_engine_pb2.RouteRequest()
    req.start.lat = 34.0522
    req.start.lng = -118.2437
    req.end.lat = 36.1699
    req.end.lng = -115.1398
    
    response = stub.CalculateRoute(req)
    
    print(f"[DEBUG] test_calculate_route_tracer_bullet | Output: Received polyline with {len(response.polyline)} nodes | Status: Success")
    
    assert len(response.polyline) == 4
    assert response.polyline[0].lat == 34.0522
    assert response.polyline[3].lat == 36.1699
