#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <utility>
#include <string>

namespace py = pybind11;

// Forward declarations
struct RoutePoint {
    double lat, lng, energy;
};

struct AlgorithmResult {
    std::string algorithm;
    std::vector<RoutePoint> path;
    double distance_m = 0.0;
    double duration_s = 0.0;
    int nodes_expanded = 0;
    double exec_time_ms = 0.0;
    double path_cost = 0.0;
    std::string debug_logs;
    bool circuit_breaker_triggered = false;

    // Stage 5 EV Execution Data
    double arrival_soc_kwh = 0.0;
    double consumed_kwh = 0.0;
    bool is_charging_stop = false;
};

struct EVParams {
    bool enabled = false;
    double effective_mass_kg = 1800.0;
    double Crr = 0.012;
    double wheel_radius_m = 0.35;
    double ac_kw_max = 11.0;
    double dc_kw_max = 250.0;
    double max_regen_power_kw = 60.0;
    double energy_uncertainty_margin_pct = 5.0;
    double battery_soh_pct = 100.0;
    double start_soc_kwh = 100.0;
    double min_waypoint_soc_kwh = 2.0;
    double min_arrival_soc_kwh = 5.0;
    double target_charge_bound_kwh = 100.0;

    // NEW (v2.1.0): Enhanced physical coefficients
    double drag_coeff = 0.23;
    double frontal_area_m2 = 2.22;
    double regen_efficiency = 0.75;
    double aux_power_kw = 0.0;
};

int get_graph_cache_size();
bool is_region_cached(const std::string& region_id);
void clear_graph_cache_for_testing();
void clear_graph_cache_for_testing();

std::vector<AlgorithmResult> calculate_all_routes(
    double start_lat, double start_lng, double end_lat, double end_lng, 
    int mock_hour, int objective_val, bool algo_debug = false,
    const std::string& output_dir = "",
    int kill_time_ms = 0,
    int debug_node_interval = 5000,
    const std::string& region_id = "",
    bool cache_evict = false,
    const std::vector<std::tuple<int, double, double, std::string, double, double, bool, std::string, double, bool, bool>>& dyn_nodes = {},
    const std::vector<std::tuple<int, int, double, int, std::string>>& dyn_edges = {},
    int max_nodes = 1000000,
    double soc_discretization_step = 0.1,
    double banding_shortest = 1.0,
    double banding_fastest = 0.1,
    double epsilon_min = 10.0,
    const EVParams& ev = {}
);
std::vector<RoutePoint> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng);

PYBIND11_MODULE(route_core, m) {
    m.doc() = R"pbdoc(
        AI Route Planner Core Engine
        ----------------------------
        High-performance pathfinding implementation in C++17.
        Provides parallel execution of BFS, Dijkstra, IDDFS, A*, and IDA*.
        Includes LRU Graph Caching and Island Detection.
    )pbdoc";
    
    // Bind RoutePoint
    py::class_<RoutePoint>(m, "RoutePoint")
        .def_readonly("lat", &RoutePoint::lat)
        .def_readonly("lng", &RoutePoint::lng)
        .def_readonly("energy", &RoutePoint::energy);

    // Bind the AlgorithmResult struct
    py::class_<AlgorithmResult>(m, "AlgorithmResult")
        .def_readonly("algorithm", &AlgorithmResult::algorithm)
        .def_readonly("path", &AlgorithmResult::path)
        .def_readonly("distance_m", &AlgorithmResult::distance_m)
        .def_readonly("duration_s", &AlgorithmResult::duration_s)
        .def_readonly("nodes_expanded", &AlgorithmResult::nodes_expanded)
        .def_readonly("exec_time_ms", &AlgorithmResult::exec_time_ms)
        .def_readonly("path_cost", &AlgorithmResult::path_cost)
        .def_readonly("debug_logs", &AlgorithmResult::debug_logs)
        .def_readonly("circuit_breaker_triggered", &AlgorithmResult::circuit_breaker_triggered)
        .def_readonly("arrival_soc_kwh", &AlgorithmResult::arrival_soc_kwh)
        .def_readonly("consumed_kwh", &AlgorithmResult::consumed_kwh)
        .def_readonly("is_charging_stop", &AlgorithmResult::is_charging_stop);

    // Bind EVParams
    py::class_<EVParams>(m, "EVParams")
        .def(py::init<>())
        .def_readwrite("enabled", &EVParams::enabled)
        .def_readwrite("effective_mass_kg", &EVParams::effective_mass_kg)
        .def_readwrite("Crr", &EVParams::Crr)
        .def_readwrite("wheel_radius_m", &EVParams::wheel_radius_m)
        .def_readwrite("ac_kw_max", &EVParams::ac_kw_max)
        .def_readwrite("dc_kw_max", &EVParams::dc_kw_max)
        .def_readwrite("max_regen_power_kw", &EVParams::max_regen_power_kw)
        .def_readwrite("energy_uncertainty_margin_pct", &EVParams::energy_uncertainty_margin_pct)
        .def_readwrite("battery_soh_pct", &EVParams::battery_soh_pct)
        .def_readwrite("start_soc_kwh", &EVParams::start_soc_kwh)
        .def_readwrite("min_waypoint_soc_kwh", &EVParams::min_waypoint_soc_kwh)
        .def_readwrite("min_arrival_soc_kwh", &EVParams::min_arrival_soc_kwh)
        .def_readwrite("target_charge_bound_kwh", &EVParams::target_charge_bound_kwh)
        .def_readwrite("drag_coeff", &EVParams::drag_coeff)
        .def_readwrite("frontal_area_m2", &EVParams::frontal_area_m2)
        .def_readwrite("regen_efficiency", &EVParams::regen_efficiency)
        .def_readwrite("aux_power_kw", &EVParams::aux_power_kw);

    // Bind the multi-algorithm calculation function
    m.def("calculate_all_routes", &calculate_all_routes, 
          py::call_guard<py::gil_scoped_release>(),
          "Calculate 5 academic routes in parallel",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"),
          py::arg("mock_hour"), py::arg("objective_val"),
          py::arg("algo_debug") = false,
          py::arg("output_dir") = std::string(""),
          py::arg("kill_time_ms") = 0,
          py::arg("debug_node_interval") = 5000,
          py::arg("region_id") = std::string(""),
          py::arg("cache_evict") = false,
          py::arg("dyn_nodes") = std::vector<std::tuple<int, double, double, std::string, double, double, bool, std::string, double, bool, bool>>(),
          py::arg("dyn_edges") = std::vector<std::tuple<int, int, double, int, std::string>>(),
          py::arg("max_nodes") = 1000000,
          py::arg("soc_discretization_step") = 0.1,
          py::arg("banding_shortest") = 1.0,
          py::arg("banding_fastest") = 0.1,
          py::arg("epsilon_min") = 10.0,
          py::arg("ev") = EVParams());

    // Bind cache utility functions
    m.def("get_graph_cache_size", &get_graph_cache_size, "Returns the current number of cached graphs");
    m.def("is_region_cached", &is_region_cached, py::arg("region_id"), "Checks if a region is cached");
    m.def("clear_graph_cache_for_testing", &clear_graph_cache_for_testing, "Clears the cache for testing purposes");

    // Bind legacy function for debug-mode
    m.def("calculate_dummy_route", &calculate_dummy_route, 
          "Calculate a dummy route between two points",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"));
}
