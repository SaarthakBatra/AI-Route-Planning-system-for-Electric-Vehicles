#include <iostream>
#include <vector>
#include <utility>
#include <chrono>
#include <cmath>
#include <queue>
#include <stack>
#include <algorithm>
#include <string>
#include <limits>
#include <future>
#include <map>
#include <set>

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

struct AlgorithmResult {
    std::string algorithm;
    std::vector<std::pair<double, double>> path;
    double distance_m;
    double duration_s;
    int nodes_expanded;
    double exec_time_ms;
    double path_cost;
};

enum class Objective {
    FASTEST = 0,
    SHORTEST = 1
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

// --- Traffic Logic ---
double get_traffic_multiplier(int mock_hour, const std::string& road_type) {
    // Peak hours: 8-10 AM and 5-7 PM
    bool is_peak = (mock_hour >= 8 && mock_hour <= 10) || (mock_hour >= 17 && mock_hour <= 19);
    if (!is_peak) return 1.0;

    if (road_type == "trunk") return 1.2;
    if (road_type == "primary") return 1.5;
    if (road_type == "secondary") return 1.8;
    return 2.0; // tertiary/other
}

double calculate_edge_cost(const Edge& edge, Objective objective, int mock_hour) {
    if (objective == Objective::SHORTEST) {
        return edge.weight_m;
    } else {
        double multiplier = get_traffic_multiplier(mock_hour, edge.road_type);
        double baseline_s = edge.weight_m / (edge.speed_kmh / 3.6);
        return baseline_s * multiplier;
    }
}

// --- Heuristics ---
double get_heuristic(int n, int target, Objective objective) {
    double dist = haversine(STATIC_NODES[n].lat, STATIC_NODES[n].lng,
                            STATIC_NODES[target].lat, STATIC_NODES[target].lng);
    if (objective == Objective::SHORTEST) {
        return dist;
    } else {
        // Temporal heuristic: distance / max speed (100 km/h)
        return dist / (100.0 / 3.6);
    }
}

// --- Path Reconstruction ---
AlgorithmResult reconstruct_path(const std::vector<int>& prev, int start_node, int end_node, const std::string& algo_name, int nodes_expanded, double exec_time, Objective objective, int mock_hour) {
    AlgorithmResult res;
    res.algorithm = algo_name;
    res.nodes_expanded = nodes_expanded;
    res.exec_time_ms = exec_time;
    res.distance_m = 0;
    res.duration_s = 0;
    res.path_cost = 0;

    if (prev[end_node] == -1 && start_node != end_node) return res;

    std::vector<int> path_ids;
    for (int at = end_node; at != -1; at = prev[at]) {
        path_ids.push_back(at);
        if (at == start_node) break;
    }
    std::reverse(path_ids.begin(), path_ids.end());

    for (size_t i = 0; i < path_ids.size(); ++i) {
        int u = path_ids[i];
        res.path.push_back({STATIC_NODES[u].lat, STATIC_NODES[u].lng});

        if (i > 0) {
            int p = path_ids[i - 1];
            for (const auto& edge : adjacency_list[p]) {
                if (edge.to == u) {
                    double edge_cost = calculate_edge_cost(edge, objective, mock_hour);
                    res.path_cost += edge_cost;
                    res.distance_m += edge.weight_m;
                    res.duration_s += (objective == Objective::FASTEST) ? edge_cost : (edge.weight_m / (edge.speed_kmh / 3.6));
                    break;
                }
            }
        }
    }
    return res;
}

// --- Algorithm Implementations ---

AlgorithmResult run_bfs(int start, int end, Objective obj, int hour) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::queue<int> q;
    std::vector<int> prev(STATIC_NODES.size(), -1);
    std::vector<bool> visited(STATIC_NODES.size(), false);
    int nodes_expanded = 0;

    q.push(start);
    visited[start] = true;

    while (!q.empty()) {
        int u = q.front();
        q.pop();
        nodes_expanded++;

        if (u == end) break;

        for (const auto& edge : adjacency_list[u]) {
            if (!visited[edge.to]) {
                visited[edge.to] = true;
                prev[edge.to] = u;
                q.push(edge.to);
            }
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    return reconstruct_path(prev, start, end, "BFS", nodes_expanded, exec_time, obj, hour);
}

AlgorithmResult run_dijkstra(int start, int end, Objective obj, int hour) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::greater<>> pq;
    std::vector<double> dist(STATIC_NODES.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(STATIC_NODES.size(), -1);
    int nodes_expanded = 0;

    dist[start] = 0;
    pq.push({0, start});

    while (!pq.empty()) {
        double d = pq.top().first;
        int u = pq.top().second;
        pq.pop();

        if (d > dist[u]) continue;
        nodes_expanded++;
        if (u == end) break;

        for (const auto& edge : adjacency_list[u]) {
            double cost = calculate_edge_cost(edge, obj, hour);
            if (dist[u] + cost < dist[edge.to]) {
                dist[edge.to] = dist[u] + cost;
                prev[edge.to] = u;
                pq.push({dist[edge.to], edge.to});
            }
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    return reconstruct_path(prev, start, end, "Dijkstra", nodes_expanded, exec_time, obj, hour);
}

AlgorithmResult run_iddfs(int start, int end, Objective obj, int hour) {
    auto start_time = std::chrono::high_resolution_clock::now();
    int nodes_expanded = 0;
    std::vector<int> final_prev(STATIC_NODES.size(), -1);

    auto dls = [&](auto self, int u, int target, int depth, std::vector<int>& prev, std::vector<bool>& visited) -> bool {
        nodes_expanded++;
        if (u == target) return true;
        if (depth <= 0) return false;

        visited[u] = true;
        for (const auto& edge : adjacency_list[u]) {
            if (!visited[edge.to]) {
                prev[edge.to] = u;
                if (self(self, edge.to, target, depth - 1, prev, visited)) return true;
            }
        }
        visited[u] = false;
        return false;
    };

    for (int limit = 0; limit < (int)STATIC_NODES.size(); ++limit) {
        std::vector<int> prev(STATIC_NODES.size(), -1);
        std::vector<bool> visited(STATIC_NODES.size(), false);
        if (dls(dls, start, end, limit, prev, visited)) {
            final_prev = prev;
            break;
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    return reconstruct_path(final_prev, start, end, "IDDFS", nodes_expanded, exec_time, obj, hour);
}

AlgorithmResult run_astar(int start, int end, Objective obj, int hour) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::greater<>> pq;
    std::vector<double> g_score(STATIC_NODES.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(STATIC_NODES.size(), -1);
    int nodes_expanded = 0;

    g_score[start] = 0;
    pq.push({get_heuristic(start, end, obj), start});

    while (!pq.empty()) {
        int u = pq.top().second;
        pq.pop();

        nodes_expanded++;
        if (u == end) break;

        for (const auto& edge : adjacency_list[u]) {
            double cost = calculate_edge_cost(edge, obj, hour);
            double tentative_g = g_score[u] + cost;
            if (tentative_g < g_score[edge.to]) {
                prev[edge.to] = u;
                g_score[edge.to] = tentative_g;
                pq.push({tentative_g + get_heuristic(edge.to, end, obj), edge.to});
            }
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    return reconstruct_path(prev, start, end, "A*", nodes_expanded, exec_time, obj, hour);
}

AlgorithmResult run_idastar(int start, int end, Objective obj, int hour) {
    auto start_time = std::chrono::high_resolution_clock::now();
    int nodes_expanded = 0;
    std::vector<int> final_path;
    std::vector<int> current_prev(STATIC_NODES.size(), -1);

    auto search = [&](auto self, int u, double g, double threshold, int target, std::vector<int>& prev, std::set<int>& path_set) -> double {
        nodes_expanded++;
        double f = g + get_heuristic(u, target, obj);
        if (f > threshold) return f;
        if (u == target) return -1.0; // Found

        double min_val = std::numeric_limits<double>::infinity();
        for (const auto& edge : adjacency_list[u]) {
            if (path_set.find(edge.to) == path_set.end()) {
                path_set.insert(edge.to);
                prev[edge.to] = u;
                double t = self(self, edge.to, g + calculate_edge_cost(edge, obj, hour), threshold, target, prev, path_set);
                if (t == -1.0) return -1.0;
                if (t < min_val) min_val = t;
                path_set.erase(edge.to);
            }
        }
        return min_val;
    };

    double threshold = get_heuristic(start, end, obj);
    std::vector<int> prev(STATIC_NODES.size(), -1);
    while (true) {
        std::set<int> path_set = {start};
        double t = search(search, start, 0, threshold, end, prev, path_set);
        if (t == -1.0) break; // Found
        if (t == std::numeric_limits<double>::infinity()) break; // Not found
        threshold = t;
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    return reconstruct_path(prev, start, end, "IDA*", nodes_expanded, exec_time, obj, hour);
}

// --- Multi-threaded Wrapper ---
std::vector<AlgorithmResult> calculate_all_routes(double start_lat, double start_lng, double end_lat, double end_lng, int mock_hour, int objective_val) {
    ensure_graph_initialized();
    int start_node = find_nearest_node(start_lat, start_lng);
    int end_node = find_nearest_node(end_lat, end_lng);
    Objective objective = static_cast<Objective>(objective_val);

    std::cout << "[DEBUG] calculate_all_routes (C++) | " << STATIC_NODES[start_node].name << " -> " << STATIC_NODES[end_node].name 
              << " | Hour: " << mock_hour << " | Obj: " << (objective == Objective::FASTEST ? "Fastest" : "Shortest") << "\n";

    auto f_bfs = std::async(std::launch::async, run_bfs, start_node, end_node, objective, mock_hour);
    auto f_dijkstra = std::async(std::launch::async, run_dijkstra, start_node, end_node, objective, mock_hour);
    auto f_iddfs = std::async(std::launch::async, run_iddfs, start_node, end_node, objective, mock_hour);
    auto f_astar = std::async(std::launch::async, run_astar, start_node, end_node, objective, mock_hour);
    auto f_idastar = std::async(std::launch::async, run_idastar, start_node, end_node, objective, mock_hour);

    return {f_bfs.get(), f_dijkstra.get(), f_iddfs.get(), f_astar.get(), f_idastar.get()};
}

// --- Legacy Wrapper ---
std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    return {
        {start_lat, start_lng},
        {start_lat + 0.01, start_lng + 0.01},
        {end_lat - 0.01, end_lng - 0.01},
        {end_lat, end_lng}
    };
}
