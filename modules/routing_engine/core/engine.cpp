#include <iostream>
#include <vector>
#include <utility>
#include <chrono>
#include <cmath>
#include <queue>
#include <algorithm>
#include <string>
#include <limits>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// --- Data Structures ---
struct Node {
    int id;
    double lat, lng;
    std::string name;
};

struct Edge {
    int to;
    double weight_m;
    int speed_kmh;
    std::string road_type;
};

struct RouteResult {
    std::vector<std::pair<double, double>> path;
    double distance_m;
    double duration_s;
    std::vector<int> node_ids;
};

// --- Utilities ---
double to_radians(double degree) {
    return degree * M_PI / 180.0;
}

double haversine(double lat1, double lng1, double lat2, double lng2) {
    double dLat = to_radians(lat2 - lat1);
    double dLng = to_radians(lng2 - lng1);
    double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
               std::cos(to_radians(lat1)) * std::cos(to_radians(lat2)) *
               std::sin(dLng / 2) * std::sin(dLng / 2);
    double c = 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
    return 6371000.0 * c; // Earth radius in meters
}

// --- Static Graph Definition ---
static std::vector<Node> STATIC_NODES = {
    {0, 28.3623, 75.6042, "Pilani"},
    {1, 28.2336, 75.6357, "Chirawa"},
    {2, 28.1283, 75.3984, "Jhunjhunu"},
    {3, 27.8521, 75.2731, "Nawalgarh"},
    {4, 27.6106, 75.1399, "Sikar"},
    {5, 27.4434, 75.5699, "Ringus"},
    {6, 27.1595, 75.7179, "Chomu"},
    {7, 26.9784, 75.7122, "Jaipur"},
    {8, 28.1312, 75.8273, "Singhana"},
    {9, 28.0457, 76.1079, "Narnaul"},
    {10, 27.7064, 76.1989, "Kotputli"},
    {11, 27.3821, 75.9684, "Manoharpur"},
    {12, 28.0557, 75.1539, "Mandawa"},
    {13, 27.9993, 74.9572, "Fatehpur"},
    {14, 27.7429, 75.3953, "Udaipurwati"},
    {15, 27.6101, 75.5168, "Khandela"},
    {16, 27.7422, 75.7923, "Neem Ka Thana"},
    {17, 28.0985, 75.4358, "Dundlod"},
    {18, 27.9773, 75.2857, "Mukundgarh"},
    {19, 27.8833, 75.5144, "Ajeetgarh"},
    {20, 27.3904, 75.9598, "Shahpura"},
    {21, 28.4366, 75.8138, "Loharu"},
    {22, 28.1800, 76.6160, "Rewari Jn."},
    {23, 26.8929, 76.3330, "Dausa"},
    {24, 27.2655, 75.9291, "Ramgarh"},
    {25, 26.9022, 75.1934, "Sambhar Lake"}
};

static std::vector<std::vector<Edge>> adjacency_list;

void ensure_graph_initialized() {
    if (!adjacency_list.empty()) return;
    adjacency_list.resize(STATIC_NODES.size());

    auto add_edge = [](int u, int v, int speed, std::string type) {
        double dist = haversine(STATIC_NODES[u].lat, STATIC_NODES[u].lng,
                               STATIC_NODES[v].lat, STATIC_NODES[v].lng);
        adjacency_list[u].push_back({v, dist, speed, type});
        adjacency_list[v].push_back({u, dist, speed, type});
    };

    // Corridor 1: NH-52
    add_edge(0, 1, 70, "primary");
    add_edge(1, 2, 70, "primary");
    add_edge(2, 17, 70, "primary");
    add_edge(17, 3, 70, "primary");
    add_edge(3, 18, 70, "primary");
    add_edge(18, 4, 100, "trunk");
    add_edge(4, 5, 100, "trunk");
    add_edge(5, 6, 100, "trunk");
    add_edge(6, 7, 70, "primary");

    // Corridor 2: NH-11 / NH-48
    add_edge(1, 8, 70, "primary");
    add_edge(8, 9, 70, "primary");
    add_edge(9, 10, 100, "trunk");
    add_edge(10, 20, 100, "trunk");
    add_edge(20, 11, 100, "trunk");
    add_edge(11, 7, 70, "primary");

    // Corridor 3: Interior / Cross-links
    add_edge(1, 12, 60, "secondary");
    add_edge(12, 13, 60, "secondary");
    add_edge(13, 4, 70, "primary");
    add_edge(12, 14, 60, "secondary");
    add_edge(14, 15, 60, "secondary");
    add_edge(15, 4, 60, "secondary");
    add_edge(15, 19, 60, "secondary");
    add_edge(19, 6, 60, "secondary");
    add_edge(2, 12, 50, "tertiary");
    add_edge(3, 14, 50, "tertiary");
    add_edge(10, 16, 70, "primary");
    add_edge(16, 4, 70, "primary");
}

int find_nearest_node(double lat, double lng) {
    int nearest_id = 0;
    double min_dist = std::numeric_limits<double>::infinity();
    for (const auto& node : STATIC_NODES) {
        double d = haversine(lat, lng, node.lat, node.lng);
        if (d < min_dist) {
            min_dist = d;
            nearest_id = node.id;
        }
    }
    return nearest_id;
}

// --- Step 1 Legacy Function ---
std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::cout << "[DEBUG] calculate_dummy_route (C++) | Input: start=(" << start_lat << "," << start_lng 
              << ") end=(" << end_lat << "," << end_lng << ")\n";

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

// --- Step 2 Dijkstra Implementation ---
RouteResult calculate_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    ensure_graph_initialized();
    auto start_time = std::chrono::high_resolution_clock::now();

    int start_node = find_nearest_node(start_lat, start_lng);
    int end_node = find_nearest_node(end_lat, end_lng);

    std::cout << "[DEBUG] calculate_route (C++) | Nearest Snapshot: " 
              << STATIC_NODES[start_node].name << "(" << start_node << ") -> " 
              << STATIC_NODES[end_node].name << "(" << end_node << ")\n";

    std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::greater<>> pq;
    std::vector<double> dist(STATIC_NODES.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(STATIC_NODES.size(), -1);

    dist[start_node] = 0;
    pq.push({0, start_node});

    while (!pq.empty()) {
        double d = pq.top().first;
        int u = pq.top().second;
        pq.pop();

        if (d > dist[u]) continue;
        if (u == end_node) break;

        for (const auto& edge : adjacency_list[u]) {
            if (dist[u] + edge.weight_m < dist[edge.to]) {
                dist[edge.to] = dist[u] + edge.weight_m;
                prev[edge.to] = u;
                pq.push({dist[edge.to], edge.to});
            }
        }
    }

    RouteResult result;
    result.distance_m = 0;
    result.duration_s = 0;

    if (dist[end_node] == std::numeric_limits<double>::infinity()) {
         std::cout << "[DEBUG] calculate_route (C++) | No path found between static nodes.\n";
         return result;
    }

    std::vector<int> path_ids;
    for (int at = end_node; at != -1; at = prev[at]) {
        path_ids.push_back(at);
    }
    std::reverse(path_ids.begin(), path_ids.end());

    result.node_ids = path_ids;
    for (size_t i = 0; i < path_ids.size(); ++i) {
        int u = path_ids[i];
        result.path.push_back({STATIC_NODES[u].lat, STATIC_NODES[u].lng});
        
        if (i > 0) {
            int p = path_ids[i-1];
            for (const auto& edge : adjacency_list[p]) {
                if (edge.to == u) {
                    result.distance_m += edge.weight_m;
                    result.duration_s += edge.weight_m / (edge.speed_kmh / 3.6);
                    break;
                }
            }
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double, std::milli> duration_ms = end_time - start_time;
    std::cout << "[DEBUG] calculate_route (C++) | Dijkstra Success | Path Nodes: " << path_ids.size() 
              << " | Dist: " << result.distance_m << "m | Dur: " << result.duration_s << "s | Time: " << duration_ms.count() << "ms\n";

    return result;
}
