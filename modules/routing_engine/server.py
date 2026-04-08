"""
Routing Engine gRPC Server
==========================
This module serves as the gRPC interface for the AI Route Planner core.
It handles:
1. gRPC request orchestration (RouteService).
2. Dynamic OSM map data ingestion and high-speed quantization.
3. Bridging Python requests to the C++ 'route_core' engine via pybind11.

--- CONFIGURATION ---
The server reads the following environment variables:
- GRAPH_CACHE_MAX_SIZE: LRU graph cache capacity (Default: 20).
- GRPC_MAX_MESSAGE_SIZE: Payload limit in bytes (Default: 100MB).
- SOC_DISCRETIZATION_STEP: SoC binning step (kWh) for Pareto (Default: 0.1).

--- WORKFLOW ---
1. gRPC CalculateRoute called with start/end coordinates.
2. Map data provided as byte-serialized Protobuf (Fast Path).
3. C++ Engine executes 5 searches in parallel with native watchdog and direct I/O.
"""
import sys
import os
import time
import logging
import json
import math
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
    logging.error("[ERROR] Protobufs not found. Please compile them first.")
    sys.exit(1)

try:
    # Import the pybind11 compiled C++ library
    sys.path.append(os.path.abspath(os.path.dirname(__file__)))
    import route_core
    logging.info("[DEBUG] route_core.so | Status: C++ module loaded via pybind11.")
except ImportError as e:
    logging.error(f"[ERROR] route_core.so not found: {e}. Build C++ extension first.")
    sys.exit(1)

def ensure_output_dir(log_dir):
    """
    Physically resolves and creates the diagnostic output directory.
    v2.3.0: Python is only responsible for the filesystem, not the I/O stream.
    """
    if not log_dir:
        return ""
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    output_path = os.path.join(root_dir, 'Output', log_dir)
    os.makedirs(output_path, exist_ok=True)
    return output_path

def get_metadata_param(metadata, key, default, type_fn=str):
    """
    Internal helper to extract parameters from gRPC metadata.
    """
    val = metadata.get(key)
    if val is None:
        return default
    try:
        return type_fn(val)
    except (ValueError, TypeError):
        return default

class RouteServiceServicer(route_engine_pb2_grpc.RouteServiceServicer):
    """
    Implementation of the RouteService gRPC servicer.
    """

    def CalculateRoute(self, request, context):
        """
        Main routing entry point. Orchestrates map ingestion, calls C++ engine synchronously.
        """
        request_metadata = dict(context.invocation_metadata())
        
        start = request.start
        end = request.end
        mock_hour = request.mock_hour
        obj_val = request.objective

        region_id = getattr(request, 'region_id', "")
        map_data_pb = getattr(request, 'map_data_pb', b"")
        cache_evict = request_metadata.get('cache-evict', '').lower() == 'true'
        is_debug_mode = request_metadata.get('debug-mode', '').lower() == 'true'

        # Legacy Debug Mode Trigger (v2.1.2 Restoration)
        if is_debug_mode:
            logging.info("[DEBUG] CalculatedRoute | Status: Legacy Debug-Mode Triggered.")
            dummy_coords = route_core.calculate_dummy_route(start.lat, start.lng, end.lat, end.lng)
            response = route_engine_pb2.RouteResponse()
            rb = response.results.add()
            rb.algorithm = "DUMMY_TRACER"
            rb.distance = 1500.0
            rb.duration = 120.0
            rb.debug_logs = "LEGACY_DUMMY_ROUTE_ENABLED"
            for pt in dummy_coords:
                p = rb.polyline.add()
                p.lat, p.lng = pt.lat, pt.lng
                p.segment_consumed_kwh = pt.energy
            return response

        dyn_nodes = []
        dyn_edges = []

        if map_data_pb:
            try:
                payload = route_engine_pb2.MapPayload()
                payload.ParseFromString(map_data_pb)
                for n in payload.nodes:
                    dyn_nodes.append((
                        n.id, n.lat, n.lng, n.name,
                        n.elevation, n.elevation_confidence,
                        n.is_charger, n.charger_type, n.kw_output,
                        n.is_operational, n.is_emergency_assumption
                    ))
                for e in payload.edges:
                    dyn_edges.append((e.u, e.v, e.weight_m, e.speed_kmh, e.road_type))
                    dyn_edges.append((e.v, e.u, e.weight_m, e.speed_kmh, e.road_type))
            except Exception as e:
                logging.error(f"[ROUTING_ENGINE] [ERROR] MapPayload failed: {e}")
        elif getattr(request, 'map_data', ""):
            # Legacy JSON Path (v2.3.0 fallback)
            try:
                osm_data = json.loads(request.map_data)
                mapping = {}
                for element in osm_data.get('elements', []):
                    if element['type'] == 'node':
                        idx = len(dyn_nodes)
                        mapping[element['id']] = idx
                        dyn_nodes.append((
                            element['id'], element['lat'], element['lon'], element.get('name', ''),
                            element.get('elevation', 0.0), element.get('elevation_confidence', 0.0),
                            element.get('is_charger', False), element.get('charger_type', ''),
                            element.get('kw_output', 0.0), element.get('is_operational', True),
                            element.get('is_emergency_assumption', False)
                        ))
                for element in osm_data.get('elements', []):
                    if element['type'] == 'way':
                        nodes = element.get('nodes', [])
                        speed = int(element.get('tags', {}).get('maxspeed', 50))
                        road_type = element.get('tags', {}).get('highway', 'residential')
                        for i in range(len(nodes) - 1):
                            u_id, v_id = nodes[i], nodes[i+1]
                            u, v = mapping.get(u_id), mapping.get(v_id)
                            if u is not None and v is not None:
                                dist = 111.0 # 0.001 degree ~ 111m
                                dyn_edges.append((u, v, dist, speed, road_type))
                                dyn_edges.append((v, u, dist, speed, road_type))
            except Exception as e:
                logging.error(f"[ROUTING_ENGINE] [ERROR] Legacy JSON parsing failed: {e}")

        # Metadata search hyperparameters (v2.3.0)
        is_algo_debug = get_metadata_param(request_metadata, 'algo-debug', 'false').lower() == 'true'
        log_dir = request_metadata.get('log-dir', "")
        output_dir = ensure_output_dir(log_dir)
        
        # Memory Safety Circuit Breaker: Force debug off if no disk sink is provided
        if not output_dir:
            is_algo_debug = False

        max_nodes = get_metadata_param(request_metadata, 'max-nodes', 1000000, int)
        kill_time_ms = get_metadata_param(request_metadata, 'kill-time-ms', 60000, int)
        debug_node_interval = get_metadata_param(request_metadata, 'debug-node-interval', 5000, int)
        soc_step = get_metadata_param(request_metadata, 'soc-discretization-step', 0.1, float)
        b_shortest = get_metadata_param(request_metadata, 'banding-shortest', 10.0, float)
        b_fastest = get_metadata_param(request_metadata, 'banding-fastest', 1.0, float)
        eps_min = get_metadata_param(request_metadata, 'epsilon-min', 10.0, float)

        # EV Parameter Mapping
        ev = route_core.EVParams()
        if hasattr(request, 'ev_params') and request.HasField('ev_params'):
            p_ev = request.ev_params
            if getattr(p_ev, 'enabled', False):
                ev.enabled = True
                ev.effective_mass_kg = p_ev.effective_mass_kg or 1800.0
                ev.Crr = p_ev.Crr or 0.012
                ev.wheel_radius_m = p_ev.wheel_radius_m or 0.35
                ev.ac_kw_max = p_ev.ac_kw_max or 11.0
                ev.dc_kw_max = p_ev.dc_kw_max or 250.0
                ev.max_regen_power_kw = p_ev.max_regen_power_kw or 60.0
                ev.energy_uncertainty_margin_pct = getattr(p_ev, 'energy_uncertainty_margin_pct', 5.0)
                ev.battery_soh_pct = getattr(p_ev, 'battery_soh_pct', 100.0) or 100.0
                ev.start_soc_kwh = p_ev.start_soc_kwh
                ev.min_waypoint_soc_kwh = p_ev.min_waypoint_soc_kwh
                ev.min_arrival_soc_kwh = p_ev.min_arrival_soc_kwh
                ev.target_charge_bound_kwh = p_ev.target_charge_bound_kwh
                ev.drag_coeff = getattr(p_ev, 'drag_coeff', 0.23) or 0.23
                ev.frontal_area_m2 = getattr(p_ev, 'frontal_area_m2', 2.22) or 2.22
                ev.regen_efficiency = getattr(p_ev, 'regen_efficiency', 0.75) or 0.75
                ev.aux_power_kw = getattr(p_ev, 'aux_power_kw', 0.0)

        try:
            # Synchronous execution - GIL is released inside C++ to allow concurrency
            cpp_results = route_core.calculate_all_routes(
                start.lat, start.lng, end.lat, end.lng, mock_hour, int(obj_val), is_algo_debug,
                output_dir, kill_time_ms, debug_node_interval,
                region_id, cache_evict, dyn_nodes, dyn_edges,
                max_nodes, soc_step, b_shortest, b_fastest, eps_min, ev
            )

            response = route_engine_pb2.RouteResponse()
            for res in cpp_results:
                rb = response.results.add()
                rb.algorithm = res.algorithm
                rb.distance = res.distance_m
                rb.duration = res.duration_s
                rb.nodes_expanded = res.nodes_expanded
                rb.exec_time_ms = res.exec_time_ms
                rb.path_cost = res.path_cost
                rb.circuit_breaker_triggered = res.circuit_breaker_triggered
                
                # Diagnostic Hardening: Truncate large logs for gRPC safety
                if is_algo_debug and output_dir:
                    rb.debug_logs = f"(TRUNCATED: Native I/O enabled. Logs in Output/{log_dir}/Algo_{res.algorithm}.md)"
                else:
                    rb.debug_logs = res.debug_logs
                
                rb.consumed_kwh = res.consumed_kwh
                rb.arrival_soc_kwh = res.arrival_soc_kwh
                rb.is_charging_stop = res.is_charging_stop
                
                for pt in res.path:
                    p = rb.polyline.add()
                    p.lat, p.lng = pt.lat, pt.lng
                    p.segment_consumed_kwh = pt.energy
            
            return response

        except Exception as e:
            logging.error(f"[ROUTING_ENGINE] [CRITICAL] C++ Engine Failure: {e}")
            context.abort(grpc.StatusCode.INTERNAL, f"C++ Engine failure: {str(e)}")

def serve():
    max_msg = int(os.getenv('GRPC_MAX_MESSAGE_SIZE', 100 * 1024 * 1024))
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10), options=[
        ('grpc.max_send_message_length', max_msg),
        ('grpc.max_receive_message_length', max_msg)
    ])
    route_engine_pb2_grpc.add_RouteServiceServicer_to_server(RouteServiceServicer(), server)
    server.add_insecure_port('[::]:50051')
    server.start()
    logging.info(f"[DEBUG] Python gRPC Server | Status: Listening on 50051 (v2.3.0 Native I/O)")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()
