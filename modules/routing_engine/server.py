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
        mock_hour = request.mock_hour
        objective = request.objective # 0: FASTEST, 1: SHORTEST
        
        # Determine algorithm mode using a priority chain:
        # Priority 1: gRPC request metadata 'debug-mode'
        # Priority 2: DEBUG_MODE environment variable
        # Priority 3: Default false (Execute 5 Academic Algorithms)
        request_metadata = dict(context.invocation_metadata())
        debug_mode_meta = request_metadata.get('debug-mode', '').lower() == 'true'
        debug_mode_env  = os.getenv('DEBUG_MODE', 'false').lower() == 'true'
        is_debug_mode = debug_mode_meta or debug_mode_env

        algo_mode   = "DUMMY_TRACER" if is_debug_mode else "PARALLEL_ACADEMIC_SUITE"
        algo_source = "metadata" if debug_mode_meta else ("env" if debug_mode_env else "default")

        logging.info(f"[DEBUG] RouteService.CalculateRoute | Mode: {algo_mode} (source: {algo_source}) | Input: start=({start.lat}, {start.lng}), end=({end.lat}, {end.lng}) | Hour: {mock_hour} | Obj: {objective}")
        
        try:
            response = route_engine_pb2.RouteResponse()
            
            if is_debug_mode:
                # Stage 1: Legacy dummy logic
                cpp_response = route_core.calculate_dummy_route(
                    start.lat, start.lng, end.lat, end.lng
                )
                
                res = response.results.add()
                res.algorithm = "DUMMY_TRACER"
                res.distance = 15000.0
                res.duration = 1800.0
                res.nodes_expanded = 4
                res.exec_time_ms = 0.1
                res.path_cost = 15000.0
                
                for lat, lng in cpp_response:
                    coord = res.polyline.add()
                    coord.lat = lat
                    coord.lng = lng
                
                logging.info(f"[DEBUG] RouteService.CalculateRoute | Output: Dummy Tracer returned 4 nodes.")
            else:
                # Stage 3: Call the parallel academic suite
                cpp_results = route_core.calculate_all_routes(
                    start.lat, start.lng, end.lat, end.lng, mock_hour, int(objective)
                )
                
                for res in cpp_results:
                    algo_res = response.results.add()
                    algo_res.algorithm = res.algorithm
                    algo_res.distance = res.distance_m
                    algo_res.duration = res.duration_s
                    algo_res.nodes_expanded = res.nodes_expanded
                    algo_res.exec_time_ms = res.exec_time_ms
                    algo_res.path_cost = res.path_cost
                    
                    for lat, lng in res.path:
                        coord = algo_res.polyline.add()
                        coord.lat = lat
                        coord.lng = lng
                    
                    logging.info(f"[DEBUG] Algorithm: {res.algorithm} | Nodes: {res.nodes_expanded} | Time: {res.exec_time_ms:.2f}ms | Cost: {res.path_cost:.2f}")

            elapsed_ms = (time.time() - start_time) * 1000
            logging.info(f"[DEBUG] RouteService.CalculateRoute | Status: Success | Total Execution: {elapsed_ms:.2f}ms")
            
            return response
            
        except Exception as e:
            logging.error(f"[DEBUG] RouteService.CalculateRoute | Output: Error={str(e)} | Status: Fail")
            import traceback
            logging.error(traceback.format_exc())
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f'Internal C++ engine failure: {str(e)}')
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
