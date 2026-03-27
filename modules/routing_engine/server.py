import sys
import os
import time
import logging
import grpc
from concurrent import futures

# Configure basic console logging matching requirements
logging.basicConfig(level=logging.DEBUG, format='%(message)s')

# Ensure we can import the generated protos
proto_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'proto'))
sys.path.append(proto_dir)

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
except ImportError:
    logging.error("[ERROR] Protobufs not found. Please compile them first using grpc_tools.")
    sys.exit(1)

try:
    # Import the pybind11 compiled C++ library
    sys.path.append(os.path.abspath(os.path.dirname(__file__)))
    import route_core
    logging.info("[DEBUG] route_core.so | Status: C++ module loaded successfully via pybind11.")
except ImportError as e:
    logging.error(f"[ERROR] route_core.so not found: {e}. Please build the C++ extension first.")
    sys.exit(1)

class RouteServiceServicer(route_engine_pb2_grpc.RouteServiceServicer):
    def CalculateRoute(self, request, context):
        start_time = time.time()
        start = request.start
        end = request.end
        
        logging.info(f"[DEBUG] RouteService.CalculateRoute | Input: start=({start.lat}, {start.lng}), end=({end.lat}, {end.lng})")
        
        try:
            # Delegate raw mathematical processing to C++ engine
            cpp_response = route_core.calculate_dummy_route(
                start.lat, start.lng, end.lat, end.lng
            )
            
            # Construct protobuf response
            response = route_engine_pb2.RouteResponse()
            response.distance = 15000.0  # Dummy distance in meters
            response.duration = 1800.0   # Dummy duration in seconds
            
            for lat, lng in cpp_response:
                coord = response.polyline.add()
                coord.lat = lat
                coord.lng = lng
                
            elapsed_ms = (time.time() - start_time) * 1000
            logging.info(f"[DEBUG] RouteService.CalculateRoute | Output: polyline_nodes={len(cpp_response)} length={response.distance}m | Status: Success | Execution: {elapsed_ms:.2f}ms")
            
            return response
            
        except Exception as e:
            logging.error(f"[DEBUG] RouteService.CalculateRoute | Output: Error={str(e)} | Status: Fail")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details('Internal C++ engine failure')
            return route_engine_pb2.RouteResponse()

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    route_engine_pb2_grpc.add_RouteServiceServicer_to_server(RouteServiceServicer(), server)
    server.add_insecure_port('[::]:50051')
    server.start()
    logging.info("[DEBUG] Python gRPC Server | Status: Listening on port 50051")
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logging.info("[DEBUG] Python gRPC Server | Status: Shutting down")

if __name__ == '__main__':
    serve()
