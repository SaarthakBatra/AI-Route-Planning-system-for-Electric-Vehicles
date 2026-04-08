import sys
import os
import time
import grpc
import argparse

# Ensure we can import the generated protos
proto_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/proto'))
sys.path.append(proto_dir)

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
except ImportError:
    print("Error: Protos not found. Please compile them first.")
    sys.exit(1)

def run_benchmark(iterations=5, nodes=5000):
    print(f"=== Starting Performance Benchmark (Nodes: {nodes}) ===")
    
    # Increase message limit to 100MB to match server defaults and handle large debug logs
    max_msg_size = 100 * 1024 * 1024
    options = [
        ('grpc.max_send_message_length', max_msg_size),
        ('grpc.max_receive_message_length', max_msg_size)
    ]
    channel = grpc.insecure_channel('localhost:50051', options=options)
    stub = route_engine_pb2_grpc.RouteServiceStub(channel)

    # 1. Create a Dense Grid Graph
    payload = route_engine_pb2.MapPayload()
    side = int(nodes**0.5)
    for i in range(side):
        for j in range(side):
            idx = i * side + j
            n = payload.nodes.add()
            n.id, n.lat, n.lng, n.elevation = idx, 45.0 + (i*0.1), 9.0 + (j*0.1), (i+j)*5.0
    
    for i in range(side):
        for j in range(side):
            u = i * side + j
            # Connect Right and Down
            if j < side - 1:
                v = u + 1
                e = payload.edges.add()
                e.u, e.v, e.weight_m, e.speed_kmh = u, v, 1000, 50
            if i < side - 1:
                v = u + side
                e = payload.edges.add()
                e.u, e.v, e.weight_m, e.speed_kmh = u, v, 1000, 50

    req = route_engine_pb2.RouteRequest()
    req.start.lat, req.start.lng = 45.0, 9.0
    req.end.lat, req.end.lng = 45.0 + ((side - 1) * 0.1), 9.0 + ((side - 1) * 0.1)
    req.map_data_pb = payload.SerializeToString() or b""

    # A. Non-EV (Fast Path)
    times_non_ev = []
    req.ev_params.enabled = False
    for i in range(iterations):
        start = time.time()
        stub.CalculateRoute(req)
        times_non_ev.append((time.time() - start) * 1000)
    
    avg_non_ev = sum(times_non_ev) / iterations
    print(f"Average Non-EV Time (O(1)): {avg_non_ev:.4f}ms")

    # B. EV (Pareto Path)
    times_ev = []
    req.ev_params.enabled = True
    req.ev_params.start_soc_kwh = 100.0
    for i in range(iterations):
        start = time.time()
        stub.CalculateRoute(req)
        times_ev.append((time.time() - start) * 1000)
    
    avg_ev = sum(times_ev) / iterations
    print(f"Average EV Time (O(N) Pareto): {avg_ev:.4f}ms")

    speedup = avg_ev / avg_non_ev if avg_non_ev > 0 else 0
    print(f"Optimization Speedup: {speedup:.2f}x")

if __name__ == '__main__':
    run_benchmark(nodes=1000) # Quick run
