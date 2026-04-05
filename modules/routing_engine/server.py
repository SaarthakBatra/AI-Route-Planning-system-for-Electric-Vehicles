"""
Routing Engine gRPC Server
==========================
This module serves as the gRPC interface for the AI Route Planner core.
It handles:
1. gRPC request orchestration (RouteService).
2. Dynamic OSM map data ingestion and high-speed quantization.
3. Thread-safe log buffering and emergency flushing for crash recovery.
4. Bridging Python requests to the C++ 'route_core' engine via pybind11.

--- CONFIGURATION ---
The server reads the following environment variables:
- ROUTING_MAX_NODES: Expansion circuit breaker (Default: 1,000,000).
- GRAPH_CACHE_MAX_SIZE: LRU graph cache capacity (Default: 20).
- GRPC_MAX_MESSAGE_SIZE: Payload limit in bytes (Default: 100MB).
- LOG_FLUSH_INTERVAL: Background flush frequency in seconds
  (Default: 0/disabled).
- ALGO_DEBUG: Enables step-by-step markdown tracing in Output/
  (Default: false).

--- WORKFLOW ---
1. gRPC CalculateRoute called with start/end coordinates.
2. Map data provided as byte-serialized Protobuf (Fast Path) or JSON (Legacy).
3. Map quantized to internal index-based graph representation.
4. C++ Engine executes 5 searches in parallel using std::async.
5. Standardized results (or Failure Signatures) returned to orchestrator.
"""
import sys
import os
import time
import logging
import json
import math
import signal
import threading
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
    logging.error(
        "[ERROR] Protobufs not found. Please compile them first."
    )
    sys.exit(1)

try:
    # Import the pybind11 compiled C++ library
    sys.path.append(os.path.abspath(os.path.dirname(__file__)))
    import route_core
    logging.info(
        "[DEBUG] route_core.so | Status: C++ module loaded via pybind11."
    )
except ImportError as e:
    logging.error(
        f"[ERROR] route_core.so not found: {e}. Build C++ extension first."
    )
    sys.exit(1)


def py_haversine(lat1, lon1, lat2, lon2):
    """
    Calculates the great-circle distance between two points in meters.

    Args:
        lat1, lon1: Coordinates of point 1.
        lat2, lon2: Coordinates of point 2.

    Returns:
        Distance in meters (float).
    """
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (math.sin(dphi / 2)**2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# Active tracking for emergency flushing
active_requests = {}
active_lock = threading.Lock()


def emergency_flush(signum=None, frame=None):
    """
    Flushes all active request buffers to disk in response to system signals.
    Useful for preserving logs during crashes or manual process termination.
    """
    with active_lock:
        if not active_requests:
            return
        logging.info(
            f"\n[EMERGENCY] Signal {signum} received. "
            f"Flushing {len(active_requests)} request(s)..."
        )
        for req_id, data in list(active_requests.items()):
            log_dir, log_ts, buf = data['dir'], data['ts'], data['buffer']
            write_md_log_buffer(log_dir, log_ts, buf, True)
            buf.clear()


def periodic_flush():
    """
    Background worker that periodically triggers an emergency flush based on
    the LOG_FLUSH_INTERVAL environment variable.
    """
    flush_interval = int(os.getenv('LOG_FLUSH_INTERVAL', '0'))
    if flush_interval > 0:
        while True:
            time.sleep(flush_interval)
            emergency_flush(None, None)


def write_md_log_buffer(log_dir, ts, buffer, is_emergency=False):
    """
    Flushes the synchronized log buffer to Output/<log_dir>/Routing_Engine.md
    """
    if not log_dir or not buffer:
        return
    current_dir = os.path.dirname(__file__)
    root_dir = os.path.abspath(os.path.join(current_dir, '..', '..'))
    output_dir = os.path.join(root_dir, 'Output', log_dir)
    os.makedirs(output_dir, exist_ok=True)

    file_path = os.path.join(output_dir, "Routing_Engine.md")

    content = ""
    if not os.path.exists(file_path):
        iso_time = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        hdr = (
            f"# ROUTING ENGINE SESSION START: {iso_time}\n"
            f"**Session ID:** {ts}\n\n"
            f"| Timestamp | Level | Message |\n"
            f"|-----------|-------|---------|\n"
        )
        content += hdr

    content += "\n".join(buffer) + "\n"

    t = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    if not is_emergency:
        content += f"\n# ROUTING ENGINE SESSION END: {t}\n"
    else:
        content += f"\n# ROUTING ENGINE SESSION ABORTED / EMERGENCY: {t}\n"

    with open(file_path, 'a') as f:
        f.write(content)


class RouteServiceServicer(route_engine_pb2_grpc.RouteServiceServicer):
    """
    Implementation of the RouteService gRPC servicer.
    """

    def CalculateRoute(self, request, context):
        """
        Main routing entry point. Orchestrates map ingestion, calls C++ engine,
        and manages logging persistence.
        """
        log_buffer = []
        request_metadata = dict(context.invocation_metadata())
        log_dir = (request_metadata.get('log-dir') or
                   request_metadata.get('log_dir'))
        log_ts = (request_metadata.get('log-timestamp') or
                  request_metadata.get('log_timestamp'))
        req_id = log_ts if log_ts else int(time.time() * 1000)

        with active_lock:
            active_requests[req_id] = {
                'dir': log_dir,
                'ts': log_ts,
                'buffer': log_buffer
            }

        if log_dir:
            logging.info(
                f"[ROUTING_ENGINE] [SESSION] Target Folder: Output/{log_dir}"
            )
        else:
            logging.warning("[ROUTING_ENGINE] [WARN] No log-dir in metadata!")

        def add_to_buffer(level, msg):
            iso_t = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            log_buffer.append(f"| {iso_t} | {level} | {msg} |")

        add_to_buffer("INFO", "Calculated Route Request Received")

        start = request.start
        end = request.end
        mock_hour = request.mock_hour
        obj_val = request.objective  # 0: FASTEST, 1: SHORTEST

        region_id = getattr(request, 'region_id', "")
        map_data_pb = getattr(request, 'map_data_pb', b"")
        map_data_str = getattr(request, 'map_data', "")
        cache_evict = (
            request_metadata.get('cache-evict', '').lower() == 'true'
        )

        # ── Map Ingestion: Dual-Path (PB/JSON Fallback) ──────────

        dyn_nodes = []
        dyn_edges = []

        if map_data_pb:
            # PRIORITY 1 — FAST PATH (v2): Binary MapPayload protobuf
            try:
                payload = route_engine_pb2.MapPayload()
                payload.ParseFromString(map_data_pb)
                size_kb = len(map_data_pb) / 1024

                msg = (
                    f"[CACHE_V2] Binary MapPayload received | "
                    f"Nodes: {len(payload.nodes)} | "
                    f"Edges: {len(payload.edges)} | "
                    f"Size: {size_kb:.1f}KB | Region: '{region_id}'"
                )
                logging.info(f"[ROUTING_ENGINE] [INFO] {msg}")
                add_to_buffer("INFO", msg)

                for n in payload.nodes:
                    dyn_nodes.append((n.id, n.lat, n.lng, n.name))
                for e in payload.edges:
                    dyn_edges.append(
                        (e.u, e.v, e.weight_m, e.speed_kmh, e.road_type)
                    )
                    dyn_edges.append(
                        (e.v, e.u, e.weight_m, e.speed_kmh, e.road_type)
                    )
            except Exception as e:
                err = f"MapPayload deserialization failed: {str(e)}"
                logging.error(f"[ROUTING_ENGINE] [ERROR] {err}")
                add_to_buffer("ERROR", err)

        elif map_data_str:
            # PRIORITY 2 — @deprecated DEPRECATED FALLBACK (v1)
            # This path is maintained for backward compatibility.
            warn_msg = (
                "[CACHE_V1] JSON string map_data used. @deprecated. "
                "Upgrade Cache module to send map_data_pb bytes "
                "for better performance."
            )
            logging.warning(f"[ROUTING_ENGINE] [WARN] {warn_msg}")
            add_to_buffer("WARN", warn_msg)
            try:
                size_kb = len(map_data_str.encode('utf-8')) / 1024
                msg = (
                    f"Map Ingestion (JSON) Triggered | "
                    f"Ingested: {size_kb:.1f}KB"
                )
                logging.info(f"[ROUTING_ENGINE] [INFO] {msg}")
                add_to_buffer("INFO", msg)

                data = json.loads(map_data_str)
                elements = data.get('elements', [])

                osm_to_internal = {}
                node_list = []
                for el in elements:
                    if el['type'] == 'node':
                        internal_id = len(node_list)
                        osm_to_internal[el['id']] = internal_id
                        node_list.append((
                            internal_id, el['lat'], el['lon'],
                            el.get('tags', {}).get('name', f"Node_{el['id']}")
                        ))

                edge_list = []
                for el in elements:
                    if el['type'] == 'way' and 'nodes' in el:
                        tags = el.get('tags', {})
                        highway = tags.get('highway', 'unclassified')
                        m_speed = tags.get('maxspeed', '50').split()[0]
                        speed = int(m_speed) if m_speed.isdigit() else 50

                        way_nodes = el['nodes']
                        for i in range(len(way_nodes) - 1):
                            u_osm = way_nodes[i]
                            v_osm = way_nodes[i+1]
                            if (u_osm in osm_to_internal and
                                    v_osm in osm_to_internal):
                                u_int = osm_to_internal[u_osm]
                                v_int = osm_to_internal[v_osm]
                                u_node = node_list[u_int]
                                v_node = node_list[v_int]
                                dist = py_haversine(
                                    u_node[1], u_node[2], v_node[1], v_node[2]
                                )
                                edge_list.append(
                                    (u_int, v_int, dist, speed, highway)
                                )
                                edge_list.append(
                                    (v_int, u_int, dist, speed, highway)
                                )

                dyn_nodes = node_list
                dyn_edges = edge_list

            except Exception as e:
                err_msg = f"Map Ingestion (JSON) Failed: {str(e)}"
                logging.error(f"[ROUTING_ENGINE] [ERROR] {err_msg}")
                add_to_buffer("ERROR", err_msg)

        # Environment & Metadata Configuration
        debug_mode_meta = (request_metadata.get('debug-mode', '').lower() ==
                           'true')
        debug_mode_env = os.getenv('DEBUG_MODE', 'false').lower() == 'true'
        is_debug_mode = debug_mode_meta or debug_mode_env

        algo_debug_meta = (request_metadata.get('algo-debug', '').lower() ==
                           'true')
        algo_debug_env = os.getenv('ALGO_DEBUG', 'false').lower() == 'true'
        is_algo_debug = algo_debug_meta or algo_debug_env

        max_nodes_meta = (request_metadata.get('max-nodes') or
                          request_metadata.get('max_nodes'))
        max_nodes_env = os.getenv('ROUTING_MAX_NODES', '1000000')
        max_nodes = int(max_nodes_meta if max_nodes_meta and
                        max_nodes_meta.isdigit() else max_nodes_env)

        # Precision Banding
        banding_shortest = float(os.getenv('ROUTING_IDA_BANDING_SHORTEST',
                                           '10.0'))
        banding_fastest = float(os.getenv('ROUTING_IDA_BANDING_FASTEST',
                                          '1.0'))
        epsilon_min = float(os.getenv('ROUTING_EPSILON_MIN', '10.0'))

        algo_mode = ("DUMMY_TRACER" if is_debug_mode else
                     "PARALLEL_ACADEMIC_SUITE")
        status_msg = (
            f"Mode: {algo_mode} | AlgoDebug: {is_algo_debug} | "
            f"MaxNodes: {max_nodes} "
        )
        logging.info(f"[DEBUG] RouteService.CalculateRoute | {status_msg}")
        add_to_buffer("DEBUG", status_msg)

        if cache_evict:
            evict_msg = (
                "[CACHE] Manual cache eviction triggered "
                "via metadata 'cache-evict: true'"
            )
            logging.info(f"[ROUTING_ENGINE] [INFO] {evict_msg}")
            add_to_buffer("INFO", evict_msg)

        try:
            response = route_engine_pb2.RouteResponse()

            if is_debug_mode:
                cpp_res = route_core.calculate_dummy_route(
                    start.lat, start.lng, end.lat, end.lng
                )
                res = response.results.add()
                res.algorithm = "DUMMY_TRACER"
                for lat, lng in cpp_res:
                    coord = res.polyline.add()
                    coord.lat, coord.lng = lat, lng
            else:
                cpp_results = route_core.calculate_all_routes(
                    start.lat, start.lng, end.lat, end.lng, mock_hour,
                    int(obj_val), is_algo_debug,
                    region_id, cache_evict,
                    dyn_nodes, dyn_edges,
                    max_nodes, banding_shortest, banding_fastest, epsilon_min
                )

                if is_algo_debug and log_dir:
                    save_algo_logs(cpp_results, log_dir, add_to_buffer)

                for res in cpp_results:
                    algo_res = response.results.add()
                    algo_res.algorithm = res.algorithm
                    algo_res.distance = res.distance_m
                    algo_res.duration = res.duration_s
                    algo_res.nodes_expanded = res.nodes_expanded
                    algo_res.exec_time_ms = res.exec_time_ms
                    algo_res.path_cost = res.path_cost
                    algo_res.debug_logs = res.debug_logs
                    algo_res.circuit_breaker_triggered = (
                        res.circuit_breaker_triggered
                    )
                    for lat, lng in res.path:
                        coord = algo_res.polyline.add()
                        coord.lat, coord.lng = lat, lng

            add_to_buffer("INFO", "Calculated Route Response Ready")
            return response
        except Exception as e:
            err_msg = f"Internal Failure: {str(e)}"
            logging.error(f"[ROUTING_ENGINE] [CRITICAL] {err_msg}")
            add_to_buffer("ERROR", err_msg)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(err_msg)
            return route_engine_pb2.RouteResponse()
        finally:
            with active_lock:
                if req_id in active_requests:
                    buf = active_requests[req_id]['buffer']
                    write_md_log_buffer(log_dir, log_ts, buf, False)
                    del active_requests[req_id]


def save_algo_logs(cpp_results, log_dir, buffer_fn):
    """
    Saves individual algorithm trace logs to the Output directory.
    """
    try:
        current_dir = os.path.dirname(__file__)
        root_dir = os.path.abspath(os.path.join(current_dir, '..', '..'))
        output_dir = os.path.join(root_dir, 'Output', log_dir)
        os.makedirs(output_dir, exist_ok=True)

        for res in cpp_results:
            if hasattr(res, 'debug_logs') and res.debug_logs:
                filename = f"Algo_{res.algorithm}.md"
                file_path = os.path.join(output_dir, filename)
                with open(file_path, 'a') as f:
                    f.write(res.debug_logs)
                buffer_fn("DEBUG", f"Algorithm Log Saved: {filename}")
    except Exception as le:
        logging.error(f"[ROUTING_ENGINE] [ERROR] Failed to save logs: {le}")
        buffer_fn("ERROR", f"Trace log save failure: {le}")


def serve():
    """
    Initializes and starts the gRPC server.
    """
    max_msg_size = int(os.getenv('GRPC_MAX_MESSAGE_SIZE', 100 * 1024 * 1024))
    options = [
        ('grpc.max_send_message_length', max_msg_size),
        ('grpc.max_receive_message_length', max_msg_size)
    ]

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10), options=options
    )
    servicer = RouteServiceServicer()
    route_engine_pb2_grpc.add_RouteServiceServicer_to_server(servicer, server)

    server.add_insecure_port('[::]:50051')
    server.start()

    cache_max_size = int(os.getenv('GRAPH_CACHE_MAX_SIZE', '20'))
    logging.info(
        f"[DEBUG] Python gRPC Server | Status: Listening on 50051 | "
        f"Max Message: {max_msg_size / 1024 / 1024:.0f}MB | "
        f"Graph Cache Max Size: {cache_max_size}"
    )

    if int(os.getenv('LOG_FLUSH_INTERVAL', '0')) > 0:
        t = threading.Thread(target=periodic_flush, daemon=True)
        t.start()

    if threading.current_thread() is threading.main_thread():
        signal.signal(
            signal.SIGINT,
            lambda s, f: (emergency_flush(s, f), sys.exit(0))
        )
        signal.signal(
            signal.SIGTERM,
            lambda s, f: (emergency_flush(s, f), sys.exit(0))
        )
        if hasattr(signal, 'SIGUSR1'):
            signal.signal(signal.SIGUSR1, emergency_flush)
    else:
        logging.info("[DEBUG] Running in non-main thread. Handlers skipped.")

    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logging.info("[DEBUG] Python gRPC Server | Status: Shutting down")


if __name__ == '__main__':
    serve()
