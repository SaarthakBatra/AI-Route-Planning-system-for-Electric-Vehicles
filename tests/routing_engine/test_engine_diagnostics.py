import sys
import os
import unittest
import time
import grpc
import re
import subprocess
import signal
import shutil

# Ensure we can import the generated protos
proto_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/proto'))
sys.path.append(proto_dir)

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
except ImportError:
    print("Error: Protos not found. Please compile them first.")
    sys.exit(1)

class TestEngineDiagnosticsV2(unittest.TestCase):
    server_process = None

    @classmethod
    def setUpClass(cls):
        """Starts the routing engine server in a background process."""
        server_script = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/server.py'))
        cls.server_process = subprocess.Popen(
            [sys.executable, server_script],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            preexec_fn=os.setsid
        )
        # Wait for server to initialize
        time.sleep(3)

    @classmethod
    def tearDownClass(cls):
        """Stops the routing engine server."""
        if cls.server_process:
            try:
                os.killpg(os.getpgid(cls.server_process.pid), signal.SIGTERM)
                cls.server_process.wait(timeout=5)
            except Exception:
                pass

    def setUp(self):
        self.channel = grpc.insecure_channel('localhost:50051')
        self.stub = route_engine_pb2_grpc.RouteServiceStub(self.channel)
        self.output_base = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../Output'))

    def test_native_watchdog_kill_time(self):
        """
        Verifies that the Native C++ Watchdog kills a search exceeding kill-time-ms.
        """
        # Create a large map to ensure search doesn't finish instantly
        payload = route_engine_pb2.MapPayload()
        for i in range(10000):
            n = payload.nodes.add()
            n.id, n.lat, n.lng = i, 45.0 + (i*0.0001), 9.0
            if i > 0:
                e = payload.edges.add()
                e.u, e.v, e.weight_m, e.speed_kmh = i-1, i, 10, 1

        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 46.0, 9.0
        request.map_data_pb = payload.SerializeToString()
        
        # Set a very aggressive 1ms timeout
        metadata = [
            ('algo-debug', 'true'),
            ('log-dir', 'test_watchdog'),
            ('kill-time-ms', '1'),
            ('debug-node-interval', '10') # Frequent checks
        ]
        
        response = self.stub.CalculateRoute(request, metadata=metadata)
        
        terminated_count = 0
        for res in response.results:
            if res.circuit_breaker_triggered:
                terminated_count += 1
                # Check for "TERMINATED" marker in disk logs
                log_path = os.path.join(self.output_base, 'test_watchdog', f"Algo_{res.algorithm}.md")
                if os.path.exists(log_path):
                    with open(log_path, 'r') as f:
                        content = f.read()
                        self.assertIn("TERMINATED", content)
                        self.assertIn("Time Limit Exceeded", content)

        self.assertTrue(terminated_count > 0, "No searches were terminated by the watchdog")
        print("Verified Native C++ Time Watchdog")

    def test_zero_ram_safety_enforcement(self):
        """
        Verifies that algo-debug is forced OFF if no log-dir is provided.
        """
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.01, 9.01
        
        # Enable algo-debug but MISSING log-dir
        metadata = [('algo-debug', 'true')] 
        
        response = self.stub.CalculateRoute(request, metadata=metadata)
        
        for res in response.results:
            # debug_logs should be empty because algo-debug was suppressed
            self.assertEqual(res.debug_logs, "", f"Debug logs leaked without output directory for {res.algorithm}")
            
        print("Verified Zero-RAM Safety Enforcement")

    def test_native_io_formatting_consistency(self):
        """
        Verifies that disk logs use the standardized markdown table format.
        """
        payload = route_engine_pb2.MapPayload()
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 0, 45.0, 9.0
        n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng = 1, 45.01, 9.01
        e = payload.edges.add(); e.u, e.v, e.weight_m, e.speed_kmh = 0, 1, 100, 50

        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.01, 9.01
        request.map_data_pb = payload.SerializeToString()
        
        log_dir = "test_format_v2"
        metadata = [
            ('algo-debug', 'true'),
            ('log-dir', log_dir),
            ('debug-node-interval', '1') # Log every node
        ]
        
        self.stub.CalculateRoute(request, metadata=metadata)
        
        # Check Dijkstra log for table format
        dijkstra_log = os.path.join(self.output_base, log_dir, "Algo_Dijkstra.md")
        self.assertTrue(os.path.exists(dijkstra_log))
        
        with open(dijkstra_log, 'r') as f:
            content = f.read()
            self.assertIn("| Step | Node ID | Cost | SoC |", content)
            self.assertIn("|---|---|---|---|", content)
            # Should have at least one expansion step
            self.assertTrue(re.search(r"\| 1 \| 0 \| 0 \|", content))
            
        print("Verified Native I/O Formatting Consistency")

    def test_response_truncation_logic(self):
        """
        Verifies that gRPC response debug_logs contains the truncation marker instead of raw logs.
        """
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.01, 9.01
        
        metadata = [
            ('algo-debug', 'true'),
            ('log-dir', 'test_truncation')
        ]
        
        response = self.stub.CalculateRoute(request, metadata=metadata)
        
        for res in response.results:
            self.assertIn("TRUNCATED: Native I/O", res.debug_logs)
            self.assertLess(len(res.debug_logs), 200, "Truncated log is too large")
            
        print("Verified gRPC Response Truncation")

if __name__ == '__main__':
    unittest.main()
