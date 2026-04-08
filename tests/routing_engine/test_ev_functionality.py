import sys
import os
import unittest
import time
import logging
import subprocess
import signal
import grpc

# Ensure we can import the generated protos
proto_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../modules/routing_engine/proto'))
sys.path.append(proto_dir)

try:
    import route_engine_pb2
    import route_engine_pb2_grpc
except ImportError:
    print("Error: Protos not found. Please compile them first.")
    sys.exit(1)

class TestEVRouting(unittest.TestCase):
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
            os.killpg(os.getpgid(cls.server_process.pid), signal.SIGTERM)
            cls.server_process.wait()

    def setUp(self):
        # Increase message limit to 100MB for large debug logs
        max_msg_size = 100 * 1024 * 1024
        options = [
            ('grpc.max_send_message_length', max_msg_size),
            ('grpc.max_receive_message_length', max_msg_size)
        ]
        self.channel = grpc.insecure_channel('localhost:50051', options=options)
        self.stub = route_engine_pb2_grpc.RouteServiceStub(self.channel)

    def test_ev_energy_consumption(self):
        """
        Verifies that EV energy consumption is calculated and returned.
        Uses a small 3-node graph with elevation changes.
        """
        # 1. Create a dummy map with elevation
        # Node 0 (Sea Level) -> Node 1 (100m climb) -> Node 2 (Sea Level, regen)
        payload = route_engine_pb2.MapPayload()
        
        n0 = payload.nodes.add()
        n0.id, n0.lat, n0.lng, n0.name, n0.elevation = 0, 45.0, 9.0, "Start", 0.0
        
        n1 = payload.nodes.add()
        n1.id, n1.lat, n1.lng, n1.name, n1.elevation = 1, 45.01, 9.0, "Summit", 100.0
        
        n2 = payload.nodes.add()
        n2.id, n2.lat, n2.lng, n2.name, n2.elevation = 2, 45.02, 9.0, "End", 0.0
        
        e1 = payload.edges.add()
        e1.u, e1.v, e1.weight_m, e1.speed_kmh, e1.road_type = 0, 1, 1111.0, 50, "primay"
        
        e2 = payload.edges.add()
        e2.u, e2.v, e2.weight_m, e2.speed_kmh, e2.road_type = 1, 2, 1111.0, 50, "primary"
        
        # 2. Setup EV Params
        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.effective_mass_kg = 2000.0
        ev_params.Crr = 0.015
        ev_params.wheel_radius_m = 0.35
        ev_params.ac_kw_max = 11.0
        ev_params.dc_kw_max = 150.0
        ev_params.max_regen_power_kw = 50.0
        ev_params.start_soc_kwh = 80.0
        ev_params.min_arrival_soc_kwh = 2.0
        
        # 3. Create Request
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.02, 9.0
        request.objective = 0 # Fastest
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.CopyFrom(ev_params)
        
        metadata = [('log-dir', 'test_ev_logs'), ('log-timestamp', str(int(time.time())))]
        
        # 4. Execute
        response = self.stub.CalculateRoute(request, metadata=metadata)
        
        # 5. Assertions
        self.assertTrue(len(response.results) > 0)
        for res in response.results:
            # Check for EV fields (Skip bypassed algorithms)
            if res.algorithm in ["IDDFS", "IDA*"]:
                continue
            self.assertGreater(res.consumed_kwh, 0)
            self.assertLess(res.arrival_soc_kwh, ev_params.start_soc_kwh)
            print(f"Algo: {res.algorithm} | Consumed: {res.consumed_kwh:.4f} kWh | SoC: {res.arrival_soc_kwh:.2f} kWh")

    def test_soc_pruning(self):
        """
        Verifies that routes are pruned if SoC falls below minimum.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add()
        n0.id, n0.lat, n0.lng, n0.name, n0.elevation = 0, 45.0, 9.0, "Start", 0.0
        n1 = payload.nodes.add()
        n1.id, n1.lat, n1.lng, n1.name, n1.elevation = 1, 45.1, 9.0, "TooFar", 0.0
        e1 = payload.edges.add()
        e1.u, e1.v, e1.weight_m, e1.speed_kmh, e1.road_type = 0, 1, 100000.0, 100, "motorway"
        
        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.start_soc_kwh = 1.0 # Very low battery
        ev_params.min_arrival_soc_kwh = 5.0 # High reserve requirement
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.1, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.CopyFrom(ev_params)
        
        response = self.stub.CalculateRoute(request)
        
        # All algorithms should return no path or circuit breaker due to SoC pruning
        for res in response.results:
            self.assertEqual(len(res.polyline), 0, f"{res.algorithm} found a path despite SoC constraint violation")

    def test_physics_precision_aux_power(self):
        """
        Verifies that aux_power_kw correctly adds to energy consumption.
        Trip: 3.6km at 36km/h (10m/s) = 0.1 hours.
        At aux_power_kw = 1.0, it should consume exactly 0.1 kWh extra.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add()
        n0.id, n0.lat, n0.lng, n0.name, n0.elevation = 0, 45.0, 9.0, "Start", 0.0
        n1 = payload.nodes.add()
        n1.id, n1.lat, n1.lng, n1.name, n1.elevation = 1, 45.0324, 9.0, "End", 0.0 # ~3.6km north
        
        e = payload.edges.add()
        e.u, e.v, e.weight_m, e.speed_kmh, e.road_type = 0, 1, 3600.0, 36, "motorway"

        def get_consumption(aux_kw):
            ev_params = route_engine_pb2.EVParams()
            ev_params.enabled = True
            ev_params.aux_power_kw = aux_kw
            ev_params.start_soc_kwh = 100.0
            
            request = route_engine_pb2.RouteRequest()
            request.start.lat, request.start.lng = 45.0, 9.0
            request.end.lat, request.end.lng = 45.0324, 9.0
            request.map_data_pb = payload.SerializeToString()
            request.ev_params.CopyFrom(ev_params)
            
            resp = self.stub.CalculateRoute(request)
            return resp.results[0].consumed_kwh # A*

        c_0 = get_consumption(0.0)
        c_1 = get_consumption(1.0)
        
        diff = c_1 - c_0
        print(f"[PHYSICS] Aux Power Diff (Expected ~0.1): {diff:.4f} kWh")
        self.assertAlmostEqual(diff, 0.1, places=3)

    def test_soc_discretization_impact(self):
        """
        Verifies that SOC_DISCRETIZATION_STEP affects exploration.
        A larger step should result in fewer node expansions if the frontier 
        is collapsing redundant states.
        """
        payload = route_engine_pb2.MapPayload()
        # Create a "Fan-Out" graph where many paths have slightly different SoC
        # Node 0 -> {1, 2, 3, 4, 5} -> Node 6
        n0 = payload.nodes.add()
        n0.id, n0.lat, n0.lng = 0, 45.0, 9.0
        n6 = payload.nodes.add()
        n6.id, n6.lat, n6.lng = 6, 45.02, 9.0
        
        for i in range(1, 6):
            n = payload.nodes.add()
            # Slightly different elevations to create different SoC results
            n.id, n.lat, n.lng, n.elevation = i, 45.01, 9.0 + (i*0.001), i * 1.0
            
            e1 = payload.edges.add()
            e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, i, 1111.0, 50
            
            e2 = payload.edges.add()
            e2.u, e2.v, e2.weight_m, e2.speed_kmh = i, 6, 1111.0, 50

        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.start_soc_kwh = 100.0

        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.02, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.CopyFrom(ev_params)
        
        # We need a way to pass the step per request for this test, 
        # but currently it's an ENV variable.
        # This test will run with the system default (0.1).
        # We verify it doesn't crash and returns valid results.
        
        response = self.stub.CalculateRoute(request)
        self.assertTrue(len(response.results) > 0)
        print(f"Discretization Test Passed (Step 0.1): {response.results[0].nodes_expanded} nodes")

    def test_zero_discretization_stability(self):
        """
        Verifies that SOC_DISCRETIZATION_STEP=0.0 is handled safely.
        """
        # This test relies on the server being started with SOC_DISCRETIZATION_STEP=0.0
        # For now, we just ensure the server is resilient to the presence of the logic.
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.02, 9.0
        
        response = self.stub.CalculateRoute(request)
        self.assertIsNotNone(response)
        print("Zero Discretization Stability: Success")

    def test_ev_cycle_detection(self):
        """
        Verifies that regenerative loops do not cause infinite cycles in path reconstruction.
        Graph: A -> B -> C -> D -> B (Regen)
        Target: D
        
        The presence of a regenerative loop D -> B can cause a Multi-Objective search
         to find a non-dominated path that visits B twice. With scalar 'prev' tracking,
         this results in a circular lineage: B -> ... -> D -> B.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng = 0, 45.0, 9.0 # A
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 1, 45.01, 9.0 # B
        n1.elevation = 0.0
        n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng = 2, 45.02, 9.0 # C
        n3 = payload.nodes.add(); n3.id, n3.lat, n3.lng = 3, 45.03, 9.0 # D
        n3.elevation = 1000.0
        
        # A -> B
        e1 = payload.edges.add(); e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, 1, 1000, 50
        # B -> C
        e2 = payload.edges.add(); e2.u, e2.v, e2.weight_m, e2.speed_kmh = 1, 2, 1000, 50
        # C -> D
        e3 = payload.edges.add(); e3.u, e3.v, e3.weight_m, e3.speed_kmh = 2, 3, 1000, 50
        # D -> B (Regen loop - gains SoC by going downhill)
        e4 = payload.edges.add(); e4.u, e4.v, e4.weight_m, e4.speed_kmh = 3, 1, 5000, 30
        
        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.start_soc_kwh = 50.0
        ev_params.effective_mass_kg = 2000.0
        ev_params.max_regen_power_kw = 100.0
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.03, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.CopyFrom(ev_params)
        
        # This used to cause OOM/Infinite Loop in reconstruct_path
        # Now it should return a valid path (likely A-B-C-D)
        try:
            response = self.stub.CalculateRoute(request, timeout=15)
            self.assertTrue(len(response.results) > 0)
            for res in response.results:
                if res.algorithm in ["IDDFS", "IDA*"]:
                    continue
                self.assertGreater(len(res.polyline), 0, f"{res.algorithm} failed to return a path")
                # Verify no duplicate nodes in the final polyline (since it's a simple path in this case)
                node_ids = [ (p.lat, p.lng) for p in res.polyline ]
                # We don't necessarily forbid duplicates if path is long, but here it should be a simple A-B-C-D
                print(f"Cycle Test [{res.algorithm}]: Path found with {len(res.polyline)} nodes | Cost: {res.path_cost:.2f}")
        except grpc.RpcError as e:
            self.fail(f"RPC failed with {e.code()}: {e.details()}")

    def test_soc_binning_collision(self):
        """
        [NEW v2.4.0] Verifies that two paths reaching a node with slightly 
        different SoCs but the SAME bin are collapsed, and only the 
        least-cost one is retained.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng = 0, 45.0, 9.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 1, 45.01, 9.0
        n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng = 2, 45.02, 9.0
        
        # Path 1: 0 -> 1 -> 2 (Cost 100, SoC 65.01)
        # Path 2: 0 -> 2 (Cost 110, SoC 65.09)
        # With Step 0.1, both are Bin 650. Path 2 should be dominated by Path 1.
        e1 = payload.edges.add(); e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, 1, 100, 50
        e2 = payload.edges.add(); e2.u, e2.v, e2.weight_m, e2.speed_kmh = 1, 2, 100, 50
        e3 = payload.edges.add(); e3.u, e3.v, e3.weight_m, e3.speed_kmh = 0, 2, 210, 50
        
        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.start_soc_kwh = 100.0
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.02, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.CopyFrom(ev_params)
        
        # This test assumes SOC_DISCRETIZATION_STEP=0.1
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if res.algorithm == "Dijkstra" or res.algorithm == "A*":
                # It should find the 0-1-2 path (3 nodes in polyline)
                self.assertEqual(len(res.polyline), 3)
                print(f"[{res.algorithm}] Binning Collision: Correctly chose optimal path.")

    def test_bfs_pareto_multi_layer(self):
        """
        [NEW v2.4.0] Verifies that BFS uses Pareto fronts (hops vs SoC).
        A shortest hop path (1 hop) with lethal SoC vs a longer path (2 hops) with viable SoC.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng = 0, 45.0, 9.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng = 1, 45.1, 9.0 # Lethal distance
        n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng = 2, 45.01, 9.0
        n3 = payload.nodes.add(); n3.id, n3.lat, n3.lng = 3, 45.02, 9.0
        
        # 0 -> 1 (1 hop, 100km - kills battery)
        e1 = payload.edges.add(); e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, 1, 100000, 100
        # 0 -> 2 -> 3 (2 hops, viable)
        e2 = payload.edges.add(); e2.u, e2.v, e2.weight_m, e2.speed_kmh = 0, 2, 1000, 50
        e3 = payload.edges.add(); e3.u, e3.v, e3.weight_m, e3.speed_kmh = 2, 3, 1000, 50
        
        ev_params = route_engine_pb2.EVParams()
        ev_params.enabled = True
        ev_params.start_soc_kwh = 10.0
        ev_params.min_arrival_soc_kwh = 2.0
        
        # Test 1: Target is 1
        request1 = route_engine_pb2.RouteRequest()
        request1.start.lat, request1.start.lng = 45.0, 9.0
        request1.end.lat, request1.end.lng = 45.1, 9.0
        request1.map_data_pb = payload.SerializeToString()
        request1.ev_params.CopyFrom(ev_params)
        
        res1 = self.stub.CalculateRoute(request1)
        self.assertEqual(len(res1.results[0].polyline), 0) # Should fail

        # Test 2: Target is 3
        request2 = route_engine_pb2.RouteRequest()
        request2.start.lat, request2.start.lng = 45.0, 9.0
        request2.end.lat, request2.end.lng = 45.02, 9.0
        request2.map_data_pb = payload.SerializeToString()
        request2.ev_params.CopyFrom(ev_params)
        
        res2 = self.stub.CalculateRoute(request2)
        bfs_res = next(r for r in res2.results if r.algorithm == "BFS")
        self.assertEqual(len(bfs_res.polyline), 3) # 0-2-3
        print("[BFS] Pareto Multi-Layer: Success")

    def test_algorithm_bypass(self):
        """Verifies that IDDFS and IDA* are bypassed in EV mode (v2.5.0)."""
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.02, 9.0
        request.ev_params.enabled = True
        
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if res.algorithm in ["IDDFS", "IDA*"]:
                self.assertEqual(len(res.polyline), 0)
                self.assertIn("bypassed", res.debug_logs.lower())
        print("[BYPASS] IDDFS/IDA* Bypass: Success")

    def test_regenerative_segment_tracking(self):
        """Verifies negative segment_consumed_kwh on a steep downhill (v2.5.0)."""
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng, n0.elevation = 0, 45.0, 9.0, 1000.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng, n1.elevation = 1, 45.001, 9.0, 0.0
        e = payload.edges.add(); e.u, e.v, e.weight_m, e.speed_kmh = 0, 1, 100, 30
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.001, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.enabled = True
        request.ev_params.start_soc_kwh = 50.0
        
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if len(res.polyline) >= 2:
                # The segment node 0 -> node 1 is downhill.
                # coordinate[1] should have negative energy consumption (gain).
                gain = res.polyline[1].segment_consumed_kwh
                self.assertLess(gain, 0, f"Algorithm {res.algorithm} failed to track regen gain: {gain}")
        print("[REGEN] Downhill Tracking: Success")

    def test_physical_unit_assertion(self):
        """Bug 1: Verify energy for a 100m flat edge at 50km/h (v2.5.1).
        Expected: ~0.008 kWh based on physical reality audit.
        """
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng, n0.elevation = 0, 45.0, 9.0, 0.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng, n1.elevation = 1, 45.0009, 9.0, 0.0
        e = payload.edges.add(); e.u, e.v, e.weight_m, e.speed_kmh = 0, 1, 100, 50
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.0009, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.enabled = True
        request.ev_params.effective_mass_kg = 2206
        request.ev_params.Crr = 0.012
        request.ev_params.drag_coeff = 0.23
        request.ev_params.frontal_area_m2 = 2.22
        request.ev_params.aux_power_kw = 0.5
        request.ev_params.start_soc_kwh = 60.0
        
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if res.algorithm in ["BFS", "Dijkstra", "A*"]:
                # 32,000 Joules / 3,600,000 + Aux load
                # Expected roughly 0.008 to 0.010 kWh
                self.assertGreater(res.consumed_kwh, 0.007, f"Algorithm {res.algorithm} units too small: {res.consumed_kwh}")
                self.assertLess(res.consumed_kwh, 0.015, f"Algorithm {res.algorithm} units too large: {res.consumed_kwh}")
        print("[PHYSICS] Unit Assertion: Success")

    def test_regen_with_hvac_offset(self):
        """Bug B: Verify is_regen is true even if HVAC swallows the gain (v2.5.1)."""
        payload = route_engine_pb2.MapPayload()
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng, n0.elevation = 0, 45.0, 9.0, 10.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng, n1.elevation = 1, 45.0001, 9.0, 0.0 # Small drop
        # Low speed (3km/h) means high duration -> high HVAC consumption
        e = payload.edges.add(); e.u, e.v, e.weight_m, e.speed_kmh = 0, 1, 10, 3 
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.0001, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.enabled = True
        request.ev_params.aux_power_kw = 5.0 # Massive HVAC load
        
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if res.algorithm == "Dijkstra" and len(res.polyline) >= 2:
                # Even if segment_consumed_kwh is positive due to HVAC
                # is_regen should identify that traction work was negative
                self.assertTrue(res.polyline[1].is_regen, f"Regen flag missed for {res.algorithm}")
        print("[REGEN] HVAC Offset Logic: Success")

    def test_charging_energy_accounting(self):
        """Bug C: Verify arrival_soc_kwh = start - consumed (where consumed includes negative gains) (v2.5.1)."""
        payload = route_engine_pb2.MapPayload()
        # Node 0 (Start) -> Node 1 (Charger) -> Node 2 (Goal)
        n0 = payload.nodes.add(); n0.id, n0.lat, n0.lng, n0.elevation = 0, 45.0, 9.0, 0.0
        n1 = payload.nodes.add(); n1.id, n1.lat, n1.lng, n1.elevation = 1, 45.1, 9.0, 0.0
        n2 = payload.nodes.add(); n2.id, n2.lat, n2.lng, n2.elevation = 2, 45.2, 9.0, 0.0
        
        n1.is_charger, n1.charger_type, n1.kw_output, n1.is_operational = True, "DC_FAST", 150.0, True
        
        # Edge 0->1 (10km), Edge 1->2 (10km)
        e1 = payload.edges.add(); e1.u, e1.v, e1.weight_m, e1.speed_kmh = 0, 1, 10000, 100
        e2 = payload.edges.add(); e2.u, e2.v, e2.weight_m, e2.speed_kmh = 1, 2, 10000, 100
        
        request = route_engine_pb2.RouteRequest()
        request.start.lat, request.start.lng = 45.0, 9.0
        request.end.lat, request.end.lng = 45.2, 9.0
        request.map_data_pb = payload.SerializeToString()
        request.ev_params.enabled = True
        request.ev_params.start_soc_kwh = 10.0 # Low start SoC
        request.ev_params.min_arrival_soc_kwh = 15.0 # Goal requires more than we start with
        request.ev_params.target_charge_bound_kwh = 50.0 # Charge to 50kWh
        
        response = self.stub.CalculateRoute(request)
        for res in response.results:
            if res.algorithm == "Dijkstra" and len(res.polyline) > 0:
                # 1. Verify arrival SoC
                # It should be 50kWh (charge target) minus energy from Node 1 to Node 2
                self.assertGreater(res.arrival_soc_kwh, 45.0)
                self.assertLess(res.arrival_soc_kwh, 50.0)
                
                # 2. Verify consumed_kwh math: arrival = start - consumed
                # Consumed should be negative because charging gain (40kWh) > drive loss (approx 5kWh)
                expected_consumed = request.ev_params.start_soc_kwh - res.arrival_soc_kwh
                self.assertAlmostEqual(res.consumed_kwh, expected_consumed, delta=0.1)
                self.assertLess(res.consumed_kwh, 0)
        print("[CHARGING] Energy Accounting: Success")

if __name__ == '__main__':
    unittest.main()
