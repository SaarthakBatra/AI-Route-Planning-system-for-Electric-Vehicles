#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <vector>
#include <utility>

namespace py = pybind11;

// Forward declaration
std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng);

PYBIND11_MODULE(route_core, m) {
    m.doc() = "C++ Core engine for AI Route Planner utilizing pybind11 bridge";
    
    // Bind the function
    m.def("calculate_dummy_route", &calculate_dummy_route, 
          "Calculate a dummy route between two points",
          py::arg("start_lat"), py::arg("start_lng"), 
          py::arg("end_lat"), py::arg("end_lng"));
}
