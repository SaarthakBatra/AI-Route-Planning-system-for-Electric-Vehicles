#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <utility>
#include <string>

namespace py = pybind11;

// Forward declarations
struct RouteResult {
    std::vector<std::pair<double, double>> path;
    double distance_m;
    double duration_s;
    std::vector<int> node_ids;
};

std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng);
RouteResult calculate_route(double start_lat, double start_lng, double end_lat, double end_lng);

PYBIND11_MODULE(route_core, m) {
    m.doc() = "C++ Core engine for AI Route Planner utilizing pybind11 bridge";
    
    // Bind the RouteResult struct
    py::class_<RouteResult>(m, "RouteResult")
        .def_readonly("path", &RouteResult::path)
        .def_readonly("distance_m", &RouteResult::distance_m)
        .def_readonly("duration_s", &RouteResult::duration_s)
        .def_readonly("node_ids", &RouteResult::node_ids);

    // Bind legacy function
    m.def("calculate_dummy_route", &calculate_dummy_route, 
          "Calculate a dummy route between two points",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"));

    // Bind real Dijkstra function
    m.def("calculate_route", &calculate_route, 
          "Calculate a real Dijkstra route on a static graph",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"));
}
