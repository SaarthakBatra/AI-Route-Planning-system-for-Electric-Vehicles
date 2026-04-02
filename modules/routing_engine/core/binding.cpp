#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <utility>
#include <string>

namespace py = pybind11;

// Forward declarations
struct AlgorithmResult {
    std::string algorithm;
    std::vector<std::pair<double, double>> path;
    double distance_m;
    double duration_s;
    int nodes_expanded;
    double exec_time_ms;
    double path_cost;
};

std::vector<AlgorithmResult> calculate_all_routes(double start_lat, double start_lng, double end_lat, double end_lng, int mock_hour, int objective_val);
std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng);

PYBIND11_MODULE(route_core, m) {
    m.doc() = "C++ Core engine for AI Route Planner utilizing pybind11 bridge";
    
    // Bind the AlgorithmResult struct
    py::class_<AlgorithmResult>(m, "AlgorithmResult")
        .def_readonly("algorithm", &AlgorithmResult::algorithm)
        .def_readonly("path", &AlgorithmResult::path)
        .def_readonly("distance_m", &AlgorithmResult::distance_m)
        .def_readonly("duration_s", &AlgorithmResult::duration_s)
        .def_readonly("nodes_expanded", &AlgorithmResult::nodes_expanded)
        .def_readonly("exec_time_ms", &AlgorithmResult::exec_time_ms)
        .def_readonly("path_cost", &AlgorithmResult::path_cost);

    // Bind the multi-algorithm calculation function
    m.def("calculate_all_routes", &calculate_all_routes, 
          "Calculate 5 academic routes in parallel",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"),
          py::arg("mock_hour"), py::arg("objective_val"));

    // Bind legacy function for debug-mode
    m.def("calculate_dummy_route", &calculate_dummy_route, 
          "Calculate a dummy route between two points",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"));
}
