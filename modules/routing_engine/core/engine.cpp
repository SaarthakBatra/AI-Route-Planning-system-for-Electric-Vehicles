/**
 * @file engine.cpp
 * @brief High-performance C++ Routing Engine core.
 * 
 * This module implements a suite of 5 academic search algorithms (BFS, Dijkstra,
 * IDDFS, A*, and IDA*) for pathfinding on road networks. It is designed to be
 * called from Python via pybind11.
 * 
 * Key Features:
 * - Hybrid Search Suite: Executes 5 algorithms in parallel via std::async.
 * - Dynamic OSM Ingestion: Builds adjacency lists from injected JSON data.
 * - Robustness: Includes Circuit Breakers (max node limits) and Island Detection.
 * - Optimization: Uses Fringe Search, Transposition Tables, and Precision Banding.
 */
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
#include <sstream>
#include <iomanip>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// --- Data Structures ---
struct Node {
    int id;
    double lat, lng;
    std::string name;
    int component_id = -1; // Added for island detection
};

struct Edge {
    int to;
    double weight_m;
    int speed_kmh;
    std::string road_type;
};

struct Graph {
    std::vector<Node> nodes;
    std::vector<std::vector<Edge>> adjacency_list;
};

struct AlgorithmResult {
    std::string algorithm;
    std::vector<std::pair<double, double>> path;
    double distance_m;
    double duration_s;
    int nodes_expanded;
    double exec_time_ms;
    double path_cost;
    std::string debug_logs;
    bool circuit_breaker_triggered = false; // Added to track limit hits
};

enum class Objective {
    FASTEST = 0,
    SHORTEST = 1
};

// --- Utilities ---
/**
 * @brief Converts degrees to radians.
 */
double to_radians(double degree) {
    return degree * M_PI / 180.0;
}

/**
 * @brief Calculates the Haversine distance between two sets of lat/lng coordinates.
 * @return Distance in meters.
 */
double haversine(double lat1, double lng1, double lat2, double lng2) {
    double dLat = to_radians(lat2 - lat1);
    double dLng = to_radians(lng2 - lng1);
    double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
               std::cos(to_radians(lat1)) * std::cos(to_radians(lat2)) *
               std::sin(dLng / 2) * std::sin(dLng / 2);
    double c = 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
    return 6371000.0 * c; // Earth radius in meters
}

// --- Static Graph Data ---
const std::vector<Node> STATIC_NODES_DATA = {
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

Graph get_static_graph() {
    Graph g;
    g.nodes = STATIC_NODES_DATA;
    g.adjacency_list.resize(g.nodes.size());

    auto add_edge = [&](int u, int v, int speed, std::string type) {
        double dist = haversine(g.nodes[u].lat, g.nodes[u].lng,
                                g.nodes[v].lat, g.nodes[v].lng);
        g.adjacency_list[u].push_back({v, dist, speed, type});
        g.adjacency_list[v].push_back({u, dist, speed, type});
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

    return g;
}

int find_nearest_node(double lat, double lng, const Graph& g) {
    int nearest_id = 0;
    double min_dist = std::numeric_limits<double>::infinity();
    for (size_t i = 0; i < g.nodes.size(); ++i) {
        double d = haversine(lat, lng, g.nodes[i].lat, g.nodes[i].lng);
        if (d < min_dist) {
            min_dist = d;
            nearest_id = i;
        }
    }
    return nearest_id;
}

// --- Dynamic Max Speed ---
double calculate_max_speed(const Graph& g) {
    double max_speed = 30.0; // Default safety floor
    for (const auto& adj : g.adjacency_list) {
        for (const auto& edge : adj) {
            if (edge.speed_kmh > max_speed) {
                max_speed = edge.speed_kmh;
            }
        }
    }
    return max_speed;
}

// --- Island Detection (Graph Labeling) ---
void compute_components(Graph& g) {
    int n = g.nodes.size();
    if (n == 0) return;
    
    int current_component = 0;
    std::vector<bool> visited(n, false);
    
    for (int i = 0; i < n; ++i) {
        if (!visited[i]) {
            // BFS/Flood Fill to label component
            std::queue<int> q;
            q.push(i);
            visited[i] = true;
            g.nodes[i].component_id = current_component;
            
            while (!q.empty()) {
                int u = q.front();
                q.pop();
                
                for (const auto& edge : g.adjacency_list[u]) {
                    if (!visited[edge.to]) {
                        visited[edge.to] = true;
                        g.nodes[edge.to].component_id = current_component;
                        q.push(edge.to);
                    }
                }
            }
            current_component++;
        }
    }
}

// --- Traffic Logic ---
double get_traffic_multiplier(int mock_hour, const std::string& road_type) {
    bool is_peak = (mock_hour >= 8 && mock_hour <= 10) || (mock_hour >= 17 && mock_hour <= 19);
    if (!is_peak) return 1.0;
    if (road_type == "trunk") return 1.2;
    if (road_type == "primary") return 1.5;
    if (road_type == "secondary") return 1.8;
    return 2.0;
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
double get_heuristic(int n, int target, Objective objective, const Graph& g, double max_speed) {
    double dist = haversine(g.nodes[n].lat, g.nodes[n].lng,
                            g.nodes[target].lat, g.nodes[target].lng);
    if (objective == Objective::SHORTEST) {
        return dist;
    } else {
        return dist / (max_speed / 3.6);
    }
}

// --- Path Reconstruction ---
AlgorithmResult reconstruct_path(const std::vector<int>& prev, int start_node, int end_node, const std::string& algo_name, int nodes_expanded, double exec_time, Objective objective, int mock_hour, const Graph& g) {
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
        res.path.push_back({g.nodes[u].lat, g.nodes[u].lng});

        if (i > 0) {
            int p = path_ids[i - 1];
            for (const auto& edge : g.adjacency_list[p]) {
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

// --- Algorithms ---
/**
 * @brief Performs a Breadth-First Search (BFS) for unweighted paths.
 * Useful for finding minimum-hop counts or verifying connectivity.
 * 
 * @param start Start node ID.
 * @param end Target node ID.
 * @param obj Search Objective (Shortest vs Fastest).
 * @param hour Traffic hour simulation.
 * @param g The road network graph.
 * @param debug_enabled If true, generates detailed trace logs.
 * @param max_nodes Circuit breaker node limit.
 * @return AlgorithmResult containing the path and stats.
 */
AlgorithmResult run_bfs(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::ostringstream oss;
    if (debug_enabled) {
        oss << "# BFS Debug Log\n";
        oss << "- Start: " << start << " (" << g.nodes[start].name << ")\n";
        oss << "- Target: " << end << " (" << g.nodes[end].name << ")\n\n";
    }

    std::queue<int> q;
    std::vector<int> prev(g.nodes.size(), -1);
    std::vector<bool> visited(g.nodes.size(), false);
    int nodes_expanded = 0;
    bool triggered = false;
    
    q.push(start);
    visited[start] = true;
    
    while (!q.empty()) {
        int u = q.front(); q.pop();
        nodes_expanded++;

        if (nodes_expanded > max_nodes) {
            triggered = true;
            if (debug_enabled) oss << "- **Circuit Breaker Triggered!** (Max nodes: " << max_nodes << ")\n";
            break;
        }
        
        if (debug_enabled) {
            oss << "### Step " << nodes_expanded << ": Expanding Node " << u << " (" << g.nodes[u].name << ")\n";
            oss << "- Queue Size: " << q.size() << "\n";
        }

        if (u == end) {
            if (debug_enabled) oss << "- **Target Reached!**\n";
            break;
        }

        for (const auto& edge : g.adjacency_list[u]) {
            if (!visited[edge.to]) {
                visited[edge.to] = true;
                prev[edge.to] = u;
                q.push(edge.to);
                if (debug_enabled) {
                    oss << "  - Added neighbor: " << edge.to << " (" << g.nodes[edge.to].name << ")\n";
                }
            }
        }
        if (debug_enabled) oss << "\n";
    }
    
    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res = reconstruct_path(prev, start, end, "BFS", nodes_expanded, exec_time, obj, hour, g);
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    return res;
}

/**
 * @brief Performs Dijkstra's algorithm for optimal paths in weighted graphs.
 * Guaranteed to find the shortest path for non-negative weights.
 * 
 * @param start Start node ID.
 * @param end Target node ID.
 * @param obj Search Objective (Shortest vs Fastest).
 * @param hour Traffic hour simulation.
 * @param g The road network graph.
 * @param debug_enabled If true, generates detailed trace logs.
 * @param max_nodes Circuit breaker node limit.
 * @return AlgorithmResult containing the path and stats.
 */
AlgorithmResult run_dijkstra(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::ostringstream oss;
    if (debug_enabled) {
        oss << "# Dijkstra Debug Log\n";
        oss << "- Start: " << start << " (" << g.nodes[start].name << ")\n";
        oss << "- Target: " << end << " (" << g.nodes[end].name << ")\n";
        oss << "- Objective: " << (obj == Objective::SHORTEST ? "Shortest" : "Fastest") << "\n\n";
    }

    std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::greater<>> pq;
    std::vector<double> dist(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(g.nodes.size(), -1);
    int nodes_expanded = 0;
    bool triggered = false;
    
    dist[start] = 0;
    pq.push({0, start});
    
    while (!pq.empty()) {
        double d = pq.top().first;
        int u = pq.top().second;
        pq.pop();
        
        if (d > dist[u]) continue;
        nodes_expanded++;

        if (nodes_expanded > max_nodes) {
            triggered = true;
            if (debug_enabled) oss << "- **Circuit Breaker Triggered!** (Max nodes: " << max_nodes << ")\n";
            break;
        }
        
        if (debug_enabled) {
            oss << "### Step " << nodes_expanded << ": Expanding Node " << u << " (" << g.nodes[u].name << ")\n";
            oss << "- Current Path Cost: " << std::fixed << std::setprecision(2) << d << "\n";
        }

        if (u == end) {
            if (debug_enabled) oss << "- **Target Reached!**\n";
            break;
        }

        for (const auto& edge : g.adjacency_list[u]) {
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
    AlgorithmResult res = reconstruct_path(prev, start, end, "Dijkstra", nodes_expanded, exec_time, obj, hour, g);
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    return res;
}

/**
 * @brief Iterative Deepening Depth-First Search (IDDFS) with Fringe Search logic.
 * Optimizes memory usage compared to BFS/Dijkstra.
 * 
 * @param start Start node ID.
 * @param end Target node ID.
 * @param obj Search Objective (Shortest vs Fastest).
 * @param hour Traffic hour simulation.
 * @param g The road network graph.
 * @param debug_enabled If true, generates detailed trace logs.
 * @param max_nodes Circuit breaker node limit.
 * @param epsilon_min Minimum cost step for iterative limit expansion.
 * @return AlgorithmResult containing the path and stats.
 */
AlgorithmResult run_iddfs(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes, double epsilon_min) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::ostringstream oss;
    if (debug_enabled) {
        oss << "# IDDFS Debug Log (Fringe Resumption + Persistent TT)\n";
        oss << "- Start: " << start << " (" << g.nodes[start].name << ")\n";
        oss << "- Target: " << end << " (" << g.nodes[end].name << ")\n\n";
    }

    int nodes_expanded = 0;
    bool triggered = false;
    std::vector<int> final_prev(g.nodes.size(), -1);
    
    struct State {
        int u;
        double cost;
        int edge_idx;
    };

    // Vector-based transposition table (Persistent across iterations)
    std::vector<double> min_cost_reached(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> best_prev(g.nodes.size(), -1);

    double total_dist = haversine(g.nodes[start].lat, g.nodes[start].lng, g.nodes[end].lat, g.nodes[end].lng);
    double epsilon = std::max(total_dist * 0.05, epsilon_min);

    double limit = 0.0;
    bool found = false;

    // Fringe Frontier
    std::vector<State> now;
    std::vector<State> later;
    now.push_back({start, 0.0, 0});
    min_cost_reached[start] = 0.0;

    while (true) {
        if (debug_enabled) oss << "### Cost Limit: " << limit << " | Fringe Size: " << now.size() << "\n";
        double next_limit = std::numeric_limits<double>::infinity();

        while (!now.empty()) {
            State root_state = now.back();
            now.pop_back();

            if (root_state.cost > min_cost_reached[root_state.u]) continue;

            std::stack<State> s;
            s.push(root_state);

            while (!s.empty()) {
                State& curr = s.top();
                int u = curr.u;
                double c = curr.cost;

                if (curr.edge_idx == 0) {
                    nodes_expanded++;
                    if (nodes_expanded > max_nodes) {
                        triggered = true;
                        break;
                    }
                    if (u == end) {
                        found = true;
                        break;
                    }
                }

                if (triggered || found) break;

                if (curr.edge_idx < (int)g.adjacency_list[u].size()) {
                    const auto& edge = g.adjacency_list[u][curr.edge_idx];
                    curr.edge_idx++;
                    
                    double edge_cost = calculate_edge_cost(edge, obj, hour);
                    double total_c = c + edge_cost;
                    
                    if (total_c <= limit) {
                        if (total_c < min_cost_reached[edge.to]) {
                            min_cost_reached[edge.to] = total_c;
                            best_prev[edge.to] = u;
                            s.push({edge.to, total_c, 0});
                        }
                    } else {
                        if (total_c < next_limit) next_limit = total_c;
                        // Avoid adding deep paths that are already exceeded
                        if (total_c < min_cost_reached[edge.to]) {
                            min_cost_reached[edge.to] = total_c; // UPDATE TT HERE
                            best_prev[edge.to] = u;              // UPDATE PREV HERE
                            later.push_back({edge.to, total_c, 0});
                        }
                    }
                } else {
                    s.pop();
                }
            }
            if (triggered || found) break;
        }

        if (triggered || found) {
            if (found) final_prev = best_prev;
            break;
        }
        if (next_limit == std::numeric_limits<double>::infinity() && later.empty()) break;
        
        // Epsilon Cost-Bucketing
        limit = limit + std::max(next_limit - limit, epsilon);
        now = std::move(later);
        later.clear();
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res = reconstruct_path(final_prev, start, end, "IDDFS", nodes_expanded, exec_time, obj, hour, g);
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    return res;
}

/**
 * @brief A* Search algorithm using Haversine distance as heuristic.
 * Combines g(n) (cost to reach n) and h(n) (estimated cost to target).
 * 
 * @param start Start node ID.
 * @param end Target node ID.
 * @param obj Search Objective (Shortest vs Fastest).
 * @param hour Traffic hour simulation.
 * @param g The road network graph.
 * @param debug_enabled If true, generates detailed trace logs.
 * @param max_nodes Circuit breaker node limit.
 * @param max_speed Global/conservative max speed for heuristic normalization.
 * @return AlgorithmResult containing the path and stats.
 */
AlgorithmResult run_astar(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes, double max_speed) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::ostringstream oss;
    if (debug_enabled) {
        oss << "# A* Debug Log\n";
        oss << "- Start: " << start << " (" << g.nodes[start].name << ")\n";
        oss << "- Target: " << end << " (" << g.nodes[end].name << ")\n";
        oss << "- Objective: " << (obj == Objective::SHORTEST ? "Shortest" : "Fastest") << "\n";
        oss << "- Max Speed for Heuristic: " << max_speed << " km/h\n\n";
    }

    std::priority_queue<std::pair<double, int>, std::vector<std::pair<double, int>>, std::greater<>> pq;
    std::vector<double> g_score(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(g.nodes.size(), -1);
    int nodes_expanded = 0;
    bool triggered = false;
    
    g_score[start] = 0;
    double h_start = get_heuristic(start, end, obj, g, max_speed);
    pq.push({h_start, start});
    
    while (!pq.empty()) {
        int u = pq.top().second;
        pq.pop();
        
        nodes_expanded++;
        if (nodes_expanded > max_nodes) {
            triggered = true;
            break;
        }

        if (u == end) {
            if (debug_enabled) oss << "- **Target Reached!**\n";
            break;
        }

        for (const auto& edge : g.adjacency_list[u]) {
            double cost = calculate_edge_cost(edge, obj, hour);
            double tentative_g = g_score[u] + cost;
            if (tentative_g < g_score[edge.to]) {
                prev[edge.to] = u;
                g_score[edge.to] = tentative_g;
                double h_score = get_heuristic(edge.to, end, obj, g, max_speed);
                pq.push({tentative_g + h_score, edge.to});
            }
        }
    }
    
    auto end_time = std::chrono::high_resolution_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res = reconstruct_path(prev, start, end, "A*", nodes_expanded, exec_time, obj, hour, g);
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    return res;
}

AlgorithmResult run_idastar_core(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes, double max_speed, double banding_val, std::ostringstream& oss, int& global_expansion) {
    int nodes_expanded = 0;
    bool triggered = false;
    std::vector<int> final_prev(g.nodes.size(), -1);
    
    struct State {
        int u;
        double g_val;
        int edge_idx;
    };

    // Vector-based transposition table (Persistent across iterations)
    std::vector<double> min_g_reached(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> best_prev(g.nodes.size(), -1);

    double threshold = get_heuristic(start, end, obj, g, max_speed);
    bool found = false;

    // Fringe Search: Maintain 'now' and 'later' frontiers
    std::vector<State> now;
    std::vector<State> later;
    now.push_back({start, 0.0, 0});
    min_g_reached[start] = 0.0;

    while (true) {
        if (debug_enabled) oss << "### Threshold: " << threshold << " | Fringe Size: " << now.size() << "\n";
        
        double min_val = std::numeric_limits<double>::infinity();

        while (!now.empty()) {
            State root_state = now.back();
            now.pop_back();

            // TT Pruning for fringe nodes (if reached via better path in CURRENT pass)
            if (root_state.g_val > min_g_reached[root_state.u]) continue;

            std::stack<State> s;
            s.push(root_state);

            while (!s.empty()) {
                State& curr = s.top();
                int u = curr.u;
                double g_curr = curr.g_val;
                double h = get_heuristic(u, end, obj, g, max_speed);
                double f = g_curr + h;

                if (curr.edge_idx == 0) {
                    nodes_expanded++;
                    global_expansion++;
                    if (global_expansion > max_nodes) {
                        triggered = true;
                        break;
                    }
                    if (f > threshold) {
                        if (f < min_val) min_val = f;
                        // Avoid adding deep paths that are already sub-optimal
                        if (g_curr <= min_g_reached[u]) {
                            min_g_reached[u] = g_curr; // Ensure TT reflects best known g for fringe
                            later.push_back(curr);
                        }
                        s.pop();
                        continue;
                    }
                    if (u == end) {
                        found = true;
                        break;
                    }
                }

                if (triggered || found) break;

                if (curr.edge_idx < (int)g.adjacency_list[u].size()) {
                    const auto& edge = g.adjacency_list[u][curr.edge_idx];
                    curr.edge_idx++;
                    
                    int v = edge.to;
                    double next_g = g_curr + calculate_edge_cost(edge, obj, hour);
                    
                    if (next_g < min_g_reached[v]) {
                        min_g_reached[v] = next_g;
                        best_prev[v] = u;
                        s.push({v, next_g, 0});
                    }
                } else {
                    s.pop();
                }
            }
            if (triggered || found) break;
        }

        if (triggered || found) {
            if (found) final_prev = best_prev;
            break;
        }
        if (min_val == std::numeric_limits<double>::infinity() && later.empty()) break;

        // Banding Buffer implementation
        threshold = threshold + std::max(banding_val, min_val - threshold);
        now = std::move(later);
        later.clear();
    }
    
    AlgorithmResult res;
    res.nodes_expanded = nodes_expanded;
    res.circuit_breaker_triggered = triggered;
    res.path_cost = std::numeric_limits<double>::infinity();

    if (found) {
        res = reconstruct_path(final_prev, start, end, "IDA*", global_expansion, 0, obj, hour, g);
        res.circuit_breaker_triggered = triggered;
    }
    return res;
}

AlgorithmResult run_idastar(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, int max_nodes, double banding_shortest, double banding_fastest) {
    auto start_time = std::chrono::high_resolution_clock::now();
    std::ostringstream oss;
    if (debug_enabled) {
        oss << "# Hybrid IDA* Debug Log\n";
        oss << "- Start: " << start << " (" << g.nodes[start].name << ")\n";
        oss << "- Target: " << end << " (" << g.nodes[end].name << ")\n\n";
    }

    double banding_val = (obj == Objective::SHORTEST) ? banding_shortest : banding_fastest;
    double max_speed_global = calculate_max_speed(g);
    
    int global_exp = 0;
    
    // Pass 1: Global Max Speed (Optimistic/Safe)
    if (debug_enabled) oss << "## Pass 1: Global Max Speed (" << max_speed_global << " kmh)\n";
    AlgorithmResult res1 = run_idastar_core(start, end, obj, hour, g, debug_enabled, max_nodes, max_speed_global, banding_val, oss, global_exp);
    
    // Pass 2: Conservative Max Speed (30 kmh floor for aggressive pruning)
    if (debug_enabled) oss << "\n## Pass 2: Conservative Max Speed (30 kmh)\n";
    AlgorithmResult res2 = run_idastar_core(start, end, obj, hour, g, debug_enabled, max_nodes, 30.0, banding_val, oss, global_exp);
    
    AlgorithmResult best_res;
    if (res1.path_cost < res2.path_cost) best_res = res1;
    else best_res = res2;

    auto end_time = std::chrono::high_resolution_clock::now();
    best_res.exec_time_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    best_res.debug_logs = oss.str();
    best_res.nodes_expanded = global_exp; // Total expanded across both runs
    best_res.algorithm = "IDA*";
    
    return best_res;
}

// --- Wrappers ---
/**
 * @brief Orchestrates and executes 5 search algorithms in parallel.
 * This is the primary entry point for the C++ engine.
 * 
 * @param start_lat, start_lng Starting coordinates.
 * @param end_lat, end_lng Ending coordinates.
 * @param mock_hour Time of day for traffic simulation.
 * @param objective_val 0 for fastest, 1 for shortest.
 * @param algo_debug If true, algorithm trace logs are generated.
 * @param dyn_nodes OSM nodes ingested dynamically.
 * @param dyn_edges OSM edges ingested dynamically.
 * @param max_nodes Circuit breaker node expansion limit.
 * @param banding_shortest IDA* banding for shortest path search.
 * @param banding_fastest IDA* banding for fastest path search.
 * @param epsilon_min IDDFS minimum step size.
 * @return std::vector<AlgorithmResult> Results for all 5 search algorithms.
 */
std::vector<AlgorithmResult> calculate_all_routes(
    double start_lat, double start_lng, double end_lat, double end_lng, 
    int mock_hour, int objective_val, bool algo_debug,
    const std::vector<std::tuple<int, double, double, std::string>>& dyn_nodes,
    const std::vector<std::tuple<int, int, double, int, std::string>>& dyn_edges,
    int max_nodes,
    double banding_shortest,
    double banding_fastest,
    double epsilon_min
) {
    Graph g;
    if (dyn_nodes.empty()) {
        g = get_static_graph();
    } else {
        // Build dynamic graph
        for (const auto& dn : dyn_nodes) {
            g.nodes.push_back({std::get<0>(dn), std::get<1>(dn), std::get<2>(dn), std::get<3>(dn)});
        }
        g.adjacency_list.resize(g.nodes.size());
        for (const auto& de : dyn_edges) {
            int u = std::get<0>(de);
            int v = std::get<1>(de);
            double dist = std::get<2>(de);
            int speed = std::get<3>(de);
            std::string type = std::get<4>(de);
            if (static_cast<size_t>(u) < g.nodes.size() && static_cast<size_t>(v) < g.nodes.size()) {
                g.adjacency_list[u].push_back({v, dist, speed, type});
            }
        }
    }

    compute_components(g); // Pre-process for Island Detection
    double max_speed = calculate_max_speed(g);

    int start_idx = find_nearest_node(start_lat, start_lng, g);
    int end_idx = find_nearest_node(end_lat, end_lng, g);
    Objective objective = static_cast<Objective>(objective_val);

    // Island Detection Check
    if (g.nodes[start_idx].component_id != g.nodes[end_idx].component_id) {
        AlgorithmResult no_route;
        no_route.distance_m = 0;
        no_route.duration_s = 0;
        no_route.nodes_expanded = 0;
        no_route.debug_logs = "Island Detection: Start and End nodes are in disconnected components.";
        
        std::vector<AlgorithmResult> results;
        std::vector<std::string> algos = {"BFS", "Dijkstra", "IDDFS", "A*", "IDA*"};
        for (const auto& name : algos) {
            AlgorithmResult r = no_route;
            r.algorithm = name;
            results.push_back(r);
        }
        return results;
    }

    auto f_bfs = std::async(std::launch::async, run_bfs, start_idx, end_idx, objective, mock_hour, std::ref(g), algo_debug, max_nodes);
    auto f_dijkstra = std::async(std::launch::async, run_dijkstra, start_idx, end_idx, objective, mock_hour, std::ref(g), algo_debug, max_nodes);
    auto f_iddfs = std::async(std::launch::async, run_iddfs, start_idx, end_idx, objective, mock_hour, std::ref(g), algo_debug, max_nodes, epsilon_min);
    auto f_astar = std::async(std::launch::async, run_astar, start_idx, end_idx, objective, mock_hour, std::ref(g), algo_debug, max_nodes, max_speed);
    auto f_idastar = std::async(std::launch::async, run_idastar, start_idx, end_idx, objective, mock_hour, std::ref(g), algo_debug, max_nodes, banding_shortest, banding_fastest);

    return {f_bfs.get(), f_dijkstra.get(), f_iddfs.get(), f_astar.get(), f_idastar.get()};
}

std::vector<std::pair<double, double>> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    return {
        {start_lat, start_lng},
        {start_lat + 0.01, start_lng + 0.01},
        {end_lat - 0.01, end_lng - 0.01},
        {end_lat, end_lng}
    };
}
