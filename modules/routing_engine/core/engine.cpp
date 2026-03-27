#include <iostream>
#include <vector>
#include <utility>
#include <chrono>

// Dummy calculation returning a hardcoded polyline
std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    auto start_time = std::chrono::high_resolution_clock::now();
    
    std::cout << "[DEBUG] calculate_dummy_route (C++) | Input: start=(" << start_lat << "," << start_lng 
              << ") end=(" << end_lat << "," << end_lng << ")\n";

    // Hardcoded simple polyline bounding box
    std::vector<std::pair<double, double>> polyline = {
        {start_lat, start_lng},
        {start_lat + 0.01, start_lng + 0.01},
        {end_lat - 0.01, end_lng - 0.01},
        {end_lat, end_lng}
    };

    auto end_time = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double, std::milli> duration = end_time - start_time;

    std::cout << "[DEBUG] calculate_dummy_route (C++) | Output: polyline_size=" << polyline.size() 
              << " | Status: Success | Time: " << duration.count() << "ms\n";

    return polyline;
}
