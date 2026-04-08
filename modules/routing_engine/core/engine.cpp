/**
 * @file engine.cpp
 * @brief High-performance C++ Routing Engine core for AI Route Planner.
 * 
 * This module implements a suite of 5 academic search algorithms (BFS, Dijkstra,
 * IDDFS, A*, and IDA*) for pathfinding on road networks. It is designed as a
 * computationally intensive monolith to maximize cache locality and instruction-level
 * parallelism through std::async.
 * 
 * --- ARCHITECTURE & WORKFLOW ---
 * 1. MAP INGESTION: The engine accepts dynamic OSM data (nodes and edges) or falls back
 *    to a static corridor for testing. Nodes are quantized into internal vector indices.
 * 2. GRAPH CACHE (LRU): To eliminate O(V+E) reconstruction latency, fully processed
 *    Graph structs are cached by 'region_id'. A cache hit provides O(1) start-to-search.
 * 3. ISLAND DETECTION: A pre-search BFS (flood fill) labels disconnected components.
 *    If start and end belong to different components, the suite aborts in <1ms.
 * 4. PARALLEL SUITE: 5 independent search threads are launched via std::async, 
 *    utilizing all available CPU cores for simultaneous algorithm benchmarking.
 * 5. FAILURE SIGNATURES: If a circuit breaker (ROUTING_MAX_NODES) is hit, the engine
 *    returns a standardized "Failure Signature" (nodes_expanded = limit + 1) to the
 *    Python layer for UI visualization.
 * 
 * --- ALGORITHMS ---
 * - BFS: Unweighted hop-count search.
 * - Dijkstra: Optimal weighted search (Priority Queue relaxation).
 * - IDDFS: Memory-efficient iterative deepening with Fringe Search optimization.
 * - A*: Heuristic-guided search (Haversine distance).
 * - IDA*: Iterative Deepening A* with Precision Banding and Geometric Overshoot (v2.0.2).
 */
#include <iostream>
#include <fstream>
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
#include <mutex>
#include <list>
#include <unordered_map>
#include <cstdlib>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// --- Data Structures ---
struct Node {
    int id;
    double lat, lng;
    std::string name;
    int component_id = -1; // Added for island detection

    // Stage 5 EV Data
    double elevation = 0.0;
    double elevation_confidence = 1.0;
    bool is_charger = false;
    std::string charger_type = "NONE";
    double kw_output = 0.0;
    bool is_operational = true;
    bool is_emergency_assumption = false;
};

struct RoutePoint {
    double lat, lng, energy;
    bool is_charging_stop = false;
    std::string charger_type = "NONE";
    double kw_output = 0.0;
    bool is_operational = true;
    double planned_soc_kwh = 0.0;
    bool is_regen = false;
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

enum class Objective {
    FASTEST = 0,
    SHORTEST = 1
};

enum class PortType {
    UNKNOWN_PORT = 0,
    IEC_62196_T2 = 1,
    CHADEMO = 2,
    CCS1 = 3,
    CCS2 = 4,
    TESLA_S = 5,
    BHARAT_DC = 6,
    WALL_PLUG = 7
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
    double start_soc_kwh = 60.0;
    double min_waypoint_soc_kwh = 6.0;
    double min_arrival_soc_kwh = 12.0;
    double target_charge_bound_kwh = 48.0;

    // NEW (v2.1.0): Enhanced physical coefficients
    double drag_coeff = 0.23;         // Default Cd (Tesla Model 3 class)
    double frontal_area_m2 = 2.22;    // Default A (Tesla Model 3 class)
    double regen_efficiency = 0.75;   // Energy recovery factor
    double aux_power_kw = 0.5;        // Idle electronics load
};

// ─── Graph Cache (LRU) ────────────────────────────────────────────────────────
//
// Purpose:
//   Persists fully-constructed Graph topology structs across gRPC calls.
//   A cache hit skips the entire O(V+E) graph build + component labeling,
//   reducing repeated-region latency from O(V+E) to O(1).
//
// Key: region_id string (e.g., "bbox:51.4_-0.18_51.6_-0.09")
//      Empty region_id bypasses the cache entirely.
//
// Eviction: Least-Recently-Used (LRU). Bounded by GRAPH_CACHE_MAX_SIZE env var.
//           Default: 20 regions. Eviction occurs on insert when at capacity.
//
// Thread Safety Model:
//   - std::mutex graph_cache_mutex guards ALL cache reads, writes, and evictions.
//   - The mutex is held ONLY for the lookup/insert/evict operation itself.
//   - It is released BEFORE std::async algorithm dispatches are launched.
//   - All 5 search algorithms take a 'const Graph&' — purely read-only.
//   - Concurrent gRPC calls on the SAME region_id: the FIRST builds and inserts
//     under the mutex. Subsequent calls find the entry and get a read reference.
//   - Concurrent gRPC calls on DIFFERENT region_ids: no contention after lookup.

struct GraphCacheEntry {
    std::shared_ptr<const Graph> graph;
    double max_speed;
};

// LRU ordering: front = most recently used, back = least recently used (evict target)
static std::list<std::string> s_lru_order;

// Primary store: region_id -> (GraphCacheEntry, iterator-into-s_lru_order)
static std::unordered_map<
    std::string,
    std::pair<GraphCacheEntry, std::list<std::string>::iterator>
> s_graph_cache;

static std::mutex s_graph_cache_mutex;

/**
 * @brief Inserts or refreshes a graph cache entry, evicting LRU if at capacity.
 * @pre MUST be called with s_graph_cache_mutex held.
 */
static void cache_insert(const std::string& region_id,
                         std::shared_ptr<const Graph> graph_ptr,
                         double max_speed,
                         int max_size) {
    auto it = s_graph_cache.find(region_id);
    if (it != s_graph_cache.end()) {
        // Already cached: refresh LRU position and update entry
        s_lru_order.erase(it->second.second);
        s_lru_order.push_front(region_id);
        it->second.first = {graph_ptr, max_speed};
        it->second.second = s_lru_order.begin();
        return;
    }
    // Evict least recently used if at capacity
    if (static_cast<int>(s_graph_cache.size()) >= max_size) {
        const std::string& lru_key = s_lru_order.back();
        s_graph_cache.erase(lru_key);
        s_lru_order.pop_back();
    }
    s_lru_order.push_front(region_id);
    s_graph_cache[region_id] = {{graph_ptr, max_speed}, s_lru_order.begin()};
}

/**
 * @brief Clears all cache entries. Called on cache-evict flag or test teardown.
 * @pre MUST be called with s_graph_cache_mutex held.
 */
static void cache_clear_locked() {
    s_graph_cache.clear();
    s_lru_order.clear();
}

/**
 * @brief Reads GRAPH_CACHE_MAX_SIZE from environment. Falls back to 20.
 */
static int get_cache_max_size() {
    const char* env = std::getenv("GRAPH_CACHE_MAX_SIZE");
    if (env) {
        int val = std::atoi(env);
        if (val > 0) return val;
    }
    return 20;
}

/** @brief Returns the current number of entries in the graph cache. */
int get_graph_cache_size() {
    std::lock_guard<std::mutex> lock(s_graph_cache_mutex);
    return static_cast<int>(s_graph_cache.size());
}

/** @brief Returns true if the given region_id is currently exists in the cache. */
bool is_region_cached(const std::string& region_id) {
    std::lock_guard<std::mutex> lock(s_graph_cache_mutex);
    return s_graph_cache.count(region_id) > 0;
}

/** @brief Fully clears the graph cache. For test isolation ONLY. */
void clear_graph_cache_for_testing() {
    std::lock_guard<std::mutex> lock(s_graph_cache_mutex);
    cache_clear_locked();
}

// --- Utilities ---
/**
 * @brief Converts degrees to radians.
 */
double to_radians(double degree) {
    return degree * M_PI / 180.0;
}

/**
 * @brief Returns a descriptive name for a node, falling back to 'Unnamed Node'.
 */
inline std::string get_node_name(const Node& n) {
    return n.name.empty() ? "Unnamed Node" : n.name;
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

// --- EV Physics Constants & Helpers ---
static constexpr double GRAVITY = 9.81;
static constexpr double AIR_DENSITY = 1.225;

/**
 * @brief Calculates the energy consumed (or regained) across an edge.
 * 
 * @param dist_m Distance in meters.
 * @param speed_mps Speed in meters per second.
 * @param grade_sin Sine of the inclination angle (elevation_diff / dist).
 * @param p Physical parameters of the vehicle.
 * @return double Energy in kWh.
 */
double calculate_ev_energy_kwh(double dist_m, double speed_mps, double grade_sin, const EVParams& p, bool& out_is_regen) {
    if (dist_m <= 0) return 0.0;
    
    double cos_theta = std::sqrt(1.0 - grade_sin * grade_sin);
    
    // 1. Forces (Newtons)
    double F_rolling = p.Crr * p.effective_mass_kg * GRAVITY * cos_theta;
    double F_drag = 0.5 * AIR_DENSITY * p.drag_coeff * p.frontal_area_m2 * speed_mps * speed_mps;
    double F_grade = p.effective_mass_kg * GRAVITY * grade_sin;
    
    double F_total = F_rolling + F_drag + F_grade;
    double Work_Joules = F_total * dist_m;
    
    double trip_duration_s = dist_m / speed_mps;
    
    // 2. Auxilliary Consumption (Electronics, HVAC) - Always Positive
    double E_aux_kwh = (p.aux_power_kw * trip_duration_s) / 3600.0;
    
    double E_traction_kwh = 0.0;
    if (Work_Joules < 0) {
        // Regenerative Braking Logic
        double Power_Watts = std::abs(Work_Joules / trip_duration_s);
        double P_regen_max_watts = p.max_regen_power_kw * 1000.0;
        double P_actual_regen = std::min(Power_Watts, P_regen_max_watts);
        
        // Convert back to Joules for this segment and apply efficiency
        double Work_Regen_Joules = -P_actual_regen * trip_duration_s * p.regen_efficiency;
        E_traction_kwh = Work_Regen_Joules / 3600000.0; 
        out_is_regen = true; 
    } else {
        // Apply safety margin to positive traction consumption
        E_traction_kwh = (Work_Joules / 3600000.0) * (1.0 + p.energy_uncertainty_margin_pct / 100.0);
        out_is_regen = false;
    }
    
    return E_traction_kwh + E_aux_kwh;
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

/**
 * @brief INTERNAL_FALLBACK_ONLY: Returns a static graph representation of the
 * Jaipur-Pilani corridor for unit testing and offline development.
 */
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

/**
 * @brief Finds the nearest graph node to a given set of coordinates.
 * 
 * @param lat, lng Input coordinates.
 * @param g The graph to search.
 * @return int Internal node index, or -1 if the graph is empty.
 */
int find_nearest_node(double lat, double lng, const Graph& g) {
    if (g.nodes.empty()) return -1;
    int nearest_id = 0;
    double min_dist = std::numeric_limits<double>::infinity();
    for (size_t i = 0; i < g.nodes.size(); ++i) {
        double d = haversine(lat, lng, g.nodes[i].lat, g.nodes[i].lng);
        if (d < min_dist) {
            min_dist = d;
            nearest_id = (int)i;
        }
    }
    return nearest_id;
}

// --- Dynamic Max Speed ---
double calculate_max_speed(const Graph& g) {
    double max_speed = 0.0;
    bool found = false;
    for (const auto& adj : g.adjacency_list) {
        for (const auto& edge : adj) {
            if (edge.speed_kmh > max_speed) {
                max_speed = edge.speed_kmh;
                found = true;
            }
        }
    }
    return found ? max_speed : 30.0; // Return 30.0 only if no edges exist
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

struct EdgeCost {
    double scalar_cost;
    double duration_s;
    double energy_kwh;
    bool is_regen = false;
};

EdgeCost calculate_edge_costs(int u, int v, const Edge& edge, Objective objective, int mock_hour, const Graph& g, const EVParams& ev) {
    EdgeCost ec;
    double multiplier = get_traffic_multiplier(mock_hour, edge.road_type);
    double speed_mps = (edge.speed_kmh / 3.6) / multiplier;
    
    ec.duration_s = edge.weight_m / speed_mps;
    
    if (ev.enabled) {
        double el_diff = g.nodes[v].elevation - g.nodes[u].elevation;
        double grade_sin = (edge.weight_m > 0) ? std::min(1.0, std::max(-1.0, el_diff / edge.weight_m)) : 0.0;
        ec.energy_kwh = calculate_ev_energy_kwh(edge.weight_m, speed_mps, grade_sin, ev, ec.is_regen);
        
        // Thermal Pre-conditioning spike if destination is DC Fast Charger
        if (g.nodes[v].is_charger && g.nodes[v].kw_output >= 50.0) {
            ec.energy_kwh += 1.5; // ~30 mins of pre-conditioning (simplified spike)
        }
    } else {
        ec.energy_kwh = 0.0;
    }

    if (objective == Objective::SHORTEST) {
        ec.scalar_cost = edge.weight_m;
    } else {
        ec.scalar_cost = ec.duration_s;
    }
    
    return ec;
}

// --- Heuristics ---
double get_heuristic(int n, int target, Objective objective, const Graph& g, double max_speed, const EVParams& ev) {
    double dist = haversine(g.nodes[n].lat, g.nodes[n].lng,
                            g.nodes[target].lat, g.nodes[target].lng);
    if (ev.enabled) {
        // Admissible EV Energy Heuristic:
        // 1. Min possible rolling resistance (flat)
        // 2. Max possible regen (steepest possible drop to target elevation)
        double el_diff = g.nodes[target].elevation - g.nodes[n].elevation;
        double grade_sin = (dist > 0) ? std::min(1.0, std::max(-1.0, el_diff / dist)) : 0.0;
        
        // Assume flat for conservative rolling cost
        double F_rolling_min = ev.Crr * ev.effective_mass_kg * GRAVITY;
        double E_min_rolling_kwh = (F_rolling_min * dist) / 3600000.0;
        
        if (el_diff < 0) {
            // Potential for regen
            double E_regen_max_kwh = (ev.effective_mass_kg * GRAVITY * std::abs(el_diff) * 0.75) / 3600000.0;
            return std::max(0.0, E_min_rolling_kwh - E_regen_max_kwh);
        }
        return E_min_rolling_kwh;
    }

    if (objective == Objective::SHORTEST) {
        return dist;
    } else {
        return dist / (max_speed / 3.6);
    }
}

// --- State-Lineage Tracker (EV Mode) ---
/**
 * @struct SearchState
 * @brief Represents a unique point in the search frontier to isolate lineages.
 * 
 * In Multi-Objective EV routing, multiple non-dominated paths can reach 
 * the same node. Using a scalar node-based 'prev' map causes pointer overwrites
 * and infinite loops. This struct allows us to backtrack through the exact
 * state-to-state parent chain, avoiding graph topology cycles entirely.
 */
struct SearchState {
    int u;             // Internal Node ID
    int parent_idx;    // Index of the parent SearchState in the local 'states' vector
    double cost;       // Cumulative scalar cost (Time or Distance)
    double soc;        // Absolute State of Charge at this point
    bool is_charging_stop = false; // Flag for charging branches (v2.5.0)
};

/**
 * @brief RECONSTRUCTION (EV MODE): Backtracks through discrete search states.
 * This version is 100% cycle-safe as it follows parent indices in the state 
 * repository rather than overwritable node pointers.
 */
AlgorithmResult reconstruct_path_from_states(const std::vector<SearchState>& states, int target_state_idx, const std::string& algo_name, int nodes_expanded, double exec_time, Objective objective, int mock_hour, const Graph& g, const EVParams& ev) {
    AlgorithmResult res;
    res.algorithm = algo_name;
    res.nodes_expanded = nodes_expanded;
    res.exec_time_ms = exec_time;
    res.distance_m = 0;
    res.duration_s = 0;
    res.path_cost = 0;
    res.consumed_kwh = 0;
    res.arrival_soc_kwh = ev.enabled ? ev.start_soc_kwh : 0.0;

    if (target_state_idx == -1) return res;

    std::vector<SearchState> path_states;
    for (int at = target_state_idx; at != -1; at = states[at].parent_idx) {
        path_states.push_back(states[at]);
        if (states[at].parent_idx == -1) break; // Reached start
    }
    std::reverse(path_states.begin(), path_states.end());

    for (size_t i = 0; i < path_states.size(); ++i) {
        int u = path_states[i].u;
        double seg_energy = 0.0;
        bool is_regen_found = false;

        if (i > 0) {
            int p = path_states[i - 1].u;
            
            // Check if this was a charging stop (Self-Loop)
            if (path_states[i].is_charging_stop && u == p) {
                seg_energy = -(path_states[i].soc - path_states[i-1].soc); // Negative consumption = gain
                res.duration_s += (path_states[i].cost - path_states[i-1].cost);
                res.consumed_kwh += seg_energy; // FIX: Tally charging energy gains
            } else {
                for (const auto& edge : g.adjacency_list[p]) {
                    if (edge.to == u) {
                        EdgeCost ec = calculate_edge_costs(p, u, edge, objective, mock_hour, g, ev);
                        res.path_cost += ec.scalar_cost;
                        res.distance_m += edge.weight_m;
                        res.duration_s += ec.duration_s;
                        res.consumed_kwh += ec.energy_kwh;
                        seg_energy = ec.energy_kwh;
                        is_regen_found = ec.is_regen;
                        break;
                    }
                }
            }
        }
        
        RoutePoint pt = {g.nodes[u].lat, g.nodes[u].lng, seg_energy};
        pt.is_charging_stop = path_states[i].is_charging_stop;
        pt.planned_soc_kwh = path_states[i].soc;
        pt.is_regen = is_regen_found;
        
        if (pt.is_charging_stop) {
            pt.charger_type = g.nodes[u].charger_type;
            pt.kw_output = g.nodes[u].kw_output;
            pt.is_operational = g.nodes[u].is_operational;
        }
        
        res.path.push_back(pt);
    }
    
    if (ev.enabled) {
        res.arrival_soc_kwh -= res.consumed_kwh;
    }
    
    return res;
}

// --- Path Reconstruction (Standard Mode - O(1) Fast Trace) ---
AlgorithmResult reconstruct_path(const std::vector<int>& prev, int start_node, int end_node, const std::string& algo_name, int nodes_expanded, double exec_time, Objective objective, int mock_hour, const Graph& g, const EVParams& ev) {
    AlgorithmResult res;
    res.algorithm = algo_name;
    res.nodes_expanded = nodes_expanded;
    res.exec_time_ms = exec_time;
    res.distance_m = 0;
    res.duration_s = 0;
    res.path_cost = 0;
    res.consumed_kwh = 0;
    res.arrival_soc_kwh = ev.enabled ? ev.start_soc_kwh : 0.0;

    if (prev[end_node] == -1 && start_node != end_node) return res;

    std::vector<int> path_ids;
    for (int at = end_node; at != -1; at = prev[at]) {
        path_ids.push_back(at);
        if (at == start_node) break;
    }
    std::reverse(path_ids.begin(), path_ids.end());

    for (size_t i = 0; i < path_ids.size(); ++i) {
        int u = path_ids[i];
        double seg_energy = 0.0;

        if (i > 0) {
            int p = path_ids[i - 1];
            for (const auto& edge : g.adjacency_list[p]) {
                if (edge.to == u) {
                    EdgeCost ec = calculate_edge_costs(p, u, edge, objective, mock_hour, g, ev);
                    res.path_cost += ec.scalar_cost;
                    res.distance_m += edge.weight_m;
                    res.duration_s += ec.duration_s;
                    res.consumed_kwh += ec.energy_kwh;
                    seg_energy = ec.energy_kwh;
                    break;
                }
            }
        }
        res.path.push_back({g.nodes[u].lat, g.nodes[u].lng, seg_energy});
    }
    
    if (ev.enabled) {
        res.arrival_soc_kwh -= res.consumed_kwh;
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
AlgorithmResult run_bfs(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, const std::string& output_dir, int kill_time_ms, int debug_node_interval, int max_nodes, double soc_step, const EVParams& ev) {
    auto start_time = std::chrono::steady_clock::now();
    std::ostringstream oss;
    std::ofstream outfile;

    if (debug_enabled && output_dir.empty()) debug_enabled = false;
    
    if (debug_enabled) {
        outfile.open(output_dir + "/Algo_BFS.md");
        outfile << "# BFS Debug Log (EV: " << (ev.enabled ? "ON" : "OFF") << ")\n";
        outfile << "- Start: " << start << " (" << get_node_name(g.nodes[start]) << ")\n";
        outfile << "- Target: " << end << " (" << get_node_name(g.nodes[end]) << ")\n\n";
        outfile << "| Step | Node ID | Cost | SoC |\n|---|---|---|---|\n";
    }

    struct Label {
        int u;
        double soc;
        int state_idx; // Index in the 'states' repository
        int hops;      // Track hops for Pareto
    };

    std::queue<Label> q;
    std::vector<SearchState> states; // Repository for EV path reconstruction
    std::vector<std::vector<std::pair<int, int>>> fronts(g.nodes.size()); // (soc_bin, hops)
    std::vector<int> prev(g.nodes.size(), -1);
    std::vector<double> best_soc(g.nodes.size(), -1.0);
    int nodes_expanded = 0;
    bool triggered = false;
    bool target_found = false;
    int target_state_idx = -1;
    
    double start_soc = ev.enabled ? ev.start_soc_kwh : 0.0;
    if (ev.enabled) {
        int start_bin = static_cast<int>(std::round(start_soc / soc_step));
        states.push_back({start, -1, 0.0, start_soc});
        q.push({start, start_soc, 0, 0});
        fronts[start].push_back({start_bin, 0});
    } else {
        q.push({start, 0.0, -1, 0});
        best_soc[start] = 0.0;
    }
    
    while (!q.empty()) {
        Label curr = q.front(); q.pop();
        int u = curr.u;
        double s = curr.soc;
        int h = curr.hops;

        nodes_expanded++;

        // --- NATIVE WATCHDOG (v2.3.1 - Detached from Debugging) ---
        if (nodes_expanded % debug_node_interval == 0) {
            auto curr_perf_time = std::chrono::steady_clock::now();
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(curr_perf_time - start_time).count();
            if (kill_time_ms > 0 && elapsed_ms > kill_time_ms) {
                if (debug_enabled) {
                    outfile << "| TERMINATED | " << g.nodes[u].id << " | Time Limit Exceeded (" << elapsed_ms << "ms) | - |\n";
                    outfile.flush();
                }
                triggered = true;
                break;
            }
        }
        
        if (debug_enabled) {
            oss << "| " << nodes_expanded << " | " << g.nodes[u].id << " | " << 0.0 << " | " << s << " |\n";
            if (nodes_expanded % debug_node_interval == 0) {
                // Hardware Sink
                outfile << oss.str();
                outfile.flush();
                oss.str(""); oss.clear();
            }
        }

        if (nodes_expanded > max_nodes) {
            triggered = true;
            if (debug_enabled) {
                oss << "[TERMINATED] **Circuit Breaker Triggered!** | Expanded: " << max_nodes 
                    << " nodes | Last Node: " << g.nodes[u].id << " (" << get_node_name(g.nodes[u]) << ")"
                    << " | Best SoC so far: " << s << "kWh.\n";
            }
            break;
        }
        
        if (u == end) {
            if (ev.enabled && s < ev.min_arrival_soc_kwh) {
                if (debug_enabled) {
                    oss << "[DEBUG] Goal Node " << g.nodes[u].id << " reached but SoC " << s << " < " << ev.min_arrival_soc_kwh << ". Checking for charging options...\n";
                }
                // Don't 'continue' here, allow charging state expansion below to potentially satisfy SoC.
            } else {
                target_found = true;
                target_state_idx = curr.state_idx;
                break;
            }
        }

        // --- CHARGING STATE EXPANSION (v2.5.0) ---
        if (ev.enabled && g.nodes[u].is_charger && g.nodes[u].is_operational) {
            if (s < ev.target_charge_bound_kwh) {
                double charge_amount = ev.target_charge_bound_kwh - s;
                double kw = g.nodes[u].kw_output;
                if (kw <= 0.0) kw = g.nodes[u].is_emergency_assumption ? 3.0 : 50.0;
                
                double charge_time_s = (charge_amount / kw) * 3600.0;
                double next_soc = ev.target_charge_bound_kwh;
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                int next_h = h + 1;
                
                bool dominated = false;
                for (const auto& f : fronts[u]) {
                    if (f.first >= next_soc_bin && f.second <= next_h) { dominated = true; break; }
                }
                
                if (!dominated) {
                    fronts[u].push_back({next_soc_bin, next_h});
                    int next_idx = static_cast<int>(states.size());
                    states.push_back({u, curr.state_idx, 0.0, next_soc, true}); 
                    q.push({u, next_soc, next_idx, next_h});
                }
            }
        }

        for (const auto& edge : g.adjacency_list[u]) {
            EdgeCost ec = calculate_edge_costs(u, edge.to, edge, obj, hour, g, ev);
            double next_soc = ev.enabled ? (s - ec.energy_kwh) : 0.0;
            bool should_update = false;

            if (ev.enabled && next_soc < ev.min_waypoint_soc_kwh) continue;

            if (best_soc[edge.to] == -1.0) {
                should_update = true;
            } else if (ev.enabled) {
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                int next_h = h + 1;
                bool dominated = false;
                for (const auto& f : fronts[edge.to]) {
                    if (f.first >= next_soc_bin && f.second <= next_h) {
                        dominated = true; break;
                    }
                }
                if (!dominated) should_update = true;
            }

            if (should_update) {
                best_soc[edge.to] = next_soc;
                if (!ev.enabled) {
                    prev[edge.to] = u;
                    q.push({edge.to, next_soc, -1, h + 1});
                } else {
                    int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                    int next_h = h + 1;
                    auto& f_to = fronts[edge.to];
                    f_to.erase(std::remove_if(f_to.begin(), f_to.end(), [&](const std::pair<int, int>& f){
                        return f.first <= next_soc_bin && f.second >= next_h;
                    }), f_to.end());
                    f_to.push_back({next_soc_bin, next_h});

                    int next_idx = static_cast<int>(states.size());
                    states.push_back({edge.to, curr.state_idx, 0.0, next_soc});
                    q.push({edge.to, next_soc, next_idx, next_h});
                }
            }
        }
    }
    
    auto end_time = std::chrono::steady_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res;
    if (target_found) {
        if (ev.enabled) {
            res = reconstruct_path_from_states(states, target_state_idx, "BFS", nodes_expanded, exec_time, obj, hour, g, ev);
        } else {
            res = reconstruct_path(prev, start, end, "BFS", nodes_expanded, exec_time, obj, hour, g, ev);
        }
    } else {
        res.algorithm = "BFS";
        res.nodes_expanded = nodes_expanded;
        res.exec_time_ms = exec_time;
    }
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    if (triggered) {
        res.nodes_expanded = max_nodes + 1;
        res.path.clear();
    }
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
AlgorithmResult run_dijkstra(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, const std::string& output_dir, int kill_time_ms, int debug_node_interval, int max_nodes, double soc_step, const EVParams& ev) {
    auto start_time = std::chrono::steady_clock::now();
    std::ostringstream oss;
    std::ofstream outfile;

    if (debug_enabled && output_dir.empty()) debug_enabled = false;

    if (debug_enabled) {
        outfile.open(output_dir + "/Algo_Dijkstra.md");
        outfile << "# Dijkstra Debug Log (EV: " << (ev.enabled ? "ON" : "OFF") << ")\n";
        outfile << "- Start: " << start << " (" << get_node_name(g.nodes[start]) << ")\n";
        outfile << "- Target: " << end << " (" << get_node_name(g.nodes[end]) << ")\n";
        outfile << "- Objective: " << (obj == Objective::SHORTEST ? "Shortest" : "Fastest") << "\n\n";
        outfile << "| Step | Node ID | Cost | SoC |\n|---|---|---|---|\n";
    }

    struct Label {
        double cost;
        double soc;
        int u;
        int state_idx; // Index in the 'states' repository
        bool operator>(const Label& other) const { return cost > other.cost; }
    };

    std::priority_queue<Label, std::vector<Label>, std::greater<Label>> pq;
    std::vector<SearchState> states; // Repository for EV path reconstruction
    std::vector<std::vector<std::pair<int, double>>> fronts(g.nodes.size()); // (soc_bin, cost)
    std::vector<double> min_costs(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(g.nodes.size(), -1);
    int nodes_expanded = 0;
    bool triggered = false;
    bool target_found = false;
    int target_state_idx = -1;
    
    double start_soc = ev.enabled ? ev.start_soc_kwh : 0.0;
    if (ev.enabled) {
        int start_bin = static_cast<int>(std::round(start_soc / soc_step));
        states.push_back({start, -1, 0.0, start_soc});
        pq.push({0.0, start_soc, start, 0});
        fronts[start].push_back({start_bin, 0.0});
    } else {
        pq.push({0.0, 0.0, start, -1});
        min_costs[start] = 0.0;
    }
    
    while (!pq.empty()) {
        Label curr = pq.top(); pq.pop();
        int u = curr.u;
        double c = curr.cost;
        double s = curr.soc;
        
        if (!ev.enabled) {
            if (c > min_costs[u]) continue;
        } else {
            int soc_bin = static_cast<int>(std::round(s / soc_step));
            bool dominated = false;
            for (const auto& f : fronts[u]) {
                if (f.first >= soc_bin && f.second <= c) { 
                    if (f.first > soc_bin || f.second < c) { dominated = true; break; }
                }
            }
            if (dominated && u != start) {
                if (debug_enabled) {
                    oss << "[PARETO_PRUNE] Node: " << g.nodes[u].id << " SoC Bin: " << soc_bin << " | Cost: " << c << " Dominated by front\n";
                }
                continue;
            }
        }

        nodes_expanded++;

        // --- NATIVE WATCHDOG (v2.3.1 - Detached from Debugging) ---
        if (nodes_expanded % debug_node_interval == 0) {
            auto curr_perf_time = std::chrono::steady_clock::now();
            auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(curr_perf_time - start_time).count();
            if (kill_time_ms > 0 && elapsed_ms > kill_time_ms) {
                if (debug_enabled) {
                    outfile << "| TERMINATED | " << g.nodes[u].id << " | Time Limit Exceeded (" << elapsed_ms << "ms) | - |\n";
                    outfile.flush();
                }
                triggered = true;
                break;
            }
        }
        
        if (debug_enabled) {
            oss << "| " << nodes_expanded << " | " << g.nodes[u].id << " | " << c << " | " << s << " |\n";
            if (nodes_expanded % debug_node_interval == 0) {
                // Hardware Sink
                outfile << oss.str();
                outfile.flush();
                oss.str(""); oss.clear();
            }
        }

        if (nodes_expanded > max_nodes) {
            triggered = true;
            if (debug_enabled) {
                oss << "[TERMINATED] **Circuit Breaker Triggered!** | Expanded: " << max_nodes 
                    << " nodes | Last Node: " << g.nodes[u].id << " (" << get_node_name(g.nodes[u]) << ")"
                    << " | Best SoC so far: " << s << "kWh.\n";
            }
            break;
        }
        
        if (u == end) {
            if (ev.enabled && s < ev.min_arrival_soc_kwh) {
                if (debug_enabled) {
                    oss << "[DEBUG] Goal Node " << g.nodes[u].id << " reached but SoC " << s << " < " << ev.min_arrival_soc_kwh << ". Checking for charging options...\n";
                }
                // Don't 'continue' here, allow charging state expansion below to potentially satisfy SoC.
            } else {
                target_found = true;
                target_state_idx = curr.state_idx;
                break;
            }
        }

        // --- CHARGING STATE EXPANSION (v2.5.0) ---
        if (ev.enabled && g.nodes[u].is_charger && g.nodes[u].is_operational) {
            if (s < ev.target_charge_bound_kwh) {
                double charge_amount = ev.target_charge_bound_kwh - s;
                double kw = g.nodes[u].kw_output;
                if (kw <= 0.0) kw = g.nodes[u].is_emergency_assumption ? 3.0 : 50.0;
                
                double charge_time_s = (charge_amount / kw) * 3600.0;
                double next_cost = c + charge_time_s;
                double next_soc = ev.target_charge_bound_kwh;
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                
                bool dominated = false;
                for (const auto& f : fronts[u]) {
                    if (f.first >= next_soc_bin && f.second <= next_cost) { 
                        if (f.first > next_soc_bin || f.second < next_cost) { dominated = true; break; }
                    }
                }
                
                if (!dominated) {
                    auto& f_u = fronts[u];
                    f_u.erase(std::remove_if(f_u.begin(), f_u.end(), [&](const std::pair<int, double>& f){
                        return f.first <= next_soc_bin && f.second >= next_cost;
                    }), f_u.end());
                    f_u.push_back({next_soc_bin, next_cost});
                    
                    int next_idx = static_cast<int>(states.size());
                    states.push_back({u, curr.state_idx, next_cost, next_soc, true});
                    pq.push({next_cost, next_soc, u, next_idx});
                }
            }
        }

        for (const auto& edge : g.adjacency_list[u]) {
            EdgeCost ec = calculate_edge_costs(u, edge.to, edge, obj, hour, g, ev);
            double next_c = c + ec.scalar_cost;
            double next_soc = ev.enabled ? (s - ec.energy_kwh) : 0.0;

            if (ev.enabled && next_soc < ev.min_waypoint_soc_kwh) continue;

            bool next_dominated = false;
            if (!ev.enabled) {
                if (next_c >= min_costs[edge.to]) next_dominated = true;
            } else {
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                for (const auto& f : fronts[edge.to]) {
                    if (f.first >= next_soc_bin && f.second <= next_c) { next_dominated = true; break; }
                }
            }

            if (!next_dominated) {
                if (!ev.enabled) {
                    min_costs[edge.to] = next_c;
                    prev[edge.to] = u;
                    pq.push({next_c, 0.0, edge.to, -1});
                } else {
                    int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                    
                    // Pruning: remove states made obsolete by the new state
                    auto& f_to = fronts[edge.to];
                    f_to.erase(std::remove_if(f_to.begin(), f_to.end(), [&](const std::pair<int, double>& f){
                        return f.first <= next_soc_bin && f.second >= next_c;
                    }), f_to.end());
                    
                    f_to.push_back({next_soc_bin, next_c});
                    int next_idx = static_cast<int>(states.size());
                    states.push_back({edge.to, curr.state_idx, next_c, next_soc});
                    pq.push({next_c, next_soc, edge.to, next_idx});
                }
            }
        }
    }
    
    auto end_time = std::chrono::steady_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res;
    if (target_found) {
        if (ev.enabled) {
            res = reconstruct_path_from_states(states, target_state_idx, "Dijkstra", nodes_expanded, exec_time, obj, hour, g, ev);
        } else {
            res = reconstruct_path(prev, start, end, "Dijkstra", nodes_expanded, exec_time, obj, hour, g, ev);
        }
    } else {
        res.algorithm = "Dijkstra";
        res.nodes_expanded = nodes_expanded;
        res.exec_time_ms = exec_time;
    }
    res.debug_logs = oss.str();
    res.circuit_breaker_triggered = triggered;
    if (triggered) {
        res.nodes_expanded = max_nodes + 1;
        res.path.clear();
    }
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
AlgorithmResult run_iddfs(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, const std::string& output_dir, int kill_time_ms, int debug_node_interval, int max_nodes, double soc_step, double epsilon_min, const EVParams& ev) {
    if (ev.enabled) {
        AlgorithmResult res;
        res.algorithm = "IDDFS";
        res.debug_logs = "IDDFS bypassed for EV routing (v2.5.0).";
        return res;
    }
    auto start_time = std::chrono::steady_clock::now();
    std::ostringstream oss;
    std::ofstream outfile;

    if (debug_enabled && output_dir.empty()) debug_enabled = false;

    if (debug_enabled) {
        outfile.open(output_dir + "/Algo_IDDFS.md");
        outfile << "# IDDFS Debug Log (EV: " << (ev.enabled ? "ON" : "OFF") << ")\n";
        outfile << "- Start: " << start << " (" << get_node_name(g.nodes[start]) << ")\n";
        outfile << "- Target: " << end << " (" << get_node_name(g.nodes[end]) << ")\n\n";
        outfile << "| Step | Node ID | Cost | SoC |\n|---|---|---|---|\n";
    }

    int total_nodes_expanded = 0;
    bool triggered = false;
    std::vector<int> final_prev(g.nodes.size(), -1);
    std::vector<SearchState> final_states;
    int final_target_state_idx = -1;
    
    struct State {
        int u;
        double cost;
        double soc;
        int state_idx;
        int edge_idx;
    };

    // (cost, -soc) fronts
    std::vector<std::vector<std::pair<int, double>>> fronts(g.nodes.size());
    std::vector<double> min_costs(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> best_prev(g.nodes.size(), -1);

    double total_dist = haversine(g.nodes[start].lat, g.nodes[start].lng, g.nodes[end].lat, g.nodes[end].lng);
    double epsilon = std::max(total_dist * 0.05, epsilon_min);
    double limit = epsilon;
    bool found = false;

    double start_soc = ev.enabled ? ev.start_soc_kwh : 0.0;

    while (true) {
        double next_limit = std::numeric_limits<double>::infinity();
        std::vector<SearchState> pass_states;
        if (ev.enabled) {
            int start_bin = static_cast<int>(std::round(start_soc / soc_step));
            fronts.assign(g.nodes.size(), {});
            fronts[start].push_back({start_bin, 0.0});
            pass_states.push_back({start, -1, 0.0, start_soc});
        } else {
            min_costs.assign(g.nodes.size(), std::numeric_limits<double>::infinity());
            min_costs[start] = 0.0;
        }

        std::stack<State> s;
        if (ev.enabled) s.push({start, 0.0, start_soc, 0, 0});
        else s.push({start, 0.0, 0.0, -1, 0});

        while (!s.empty()) {
            State& curr = s.top();
            int u = curr.u;
            double c = curr.cost;
            double soc = curr.soc;

            if (curr.edge_idx == 0) {
                total_nodes_expanded++;

                // --- NATIVE WATCHDOG (v2.3.1 - Detached from Debugging) ---
                if (total_nodes_expanded % debug_node_interval == 0) {
                    auto curr_perf_time = std::chrono::steady_clock::now();
                    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(curr_perf_time - start_time).count();
                    if (kill_time_ms > 0 && elapsed_ms > kill_time_ms) {
                        if (debug_enabled) {
                            outfile << "| TERMINATED | " << g.nodes[u].id << " | Time Limit Exceeded (" << elapsed_ms << "ms) | - |\n";
                            outfile.flush();
                        }
                        triggered = true;
                        break;
                    }
                }
                
                if (debug_enabled) {
                    oss << "| " << total_nodes_expanded << " | " << g.nodes[u].id << " | " << c << " | " << soc << " |\n";
                    if (total_nodes_expanded % debug_node_interval == 0) {
                        // Hardware Sink
                        outfile << oss.str();
                        outfile.flush();
                        oss.str(""); oss.clear();
                    }
                }

                if (total_nodes_expanded > max_nodes) {
                    triggered = true;
                    if (debug_enabled) {
                        outfile << "| TERMINATED | " << g.nodes[u].id << " | Circuit Breaker (Nodes) | - |\n";
                    }
                    break;
                }
                
                if (u == end) {
                    if (ev.enabled && soc < ev.min_arrival_soc_kwh) {
                        if (debug_enabled) {
                            outfile << "| SEARCHING | " << g.nodes[u].id << " | Found Target (Low SoC) | " << soc << " |\n";
                        }
                    }
                    else { 
                        found = true; 
                        final_target_state_idx = curr.state_idx;
                        if (debug_enabled) outfile << "| SUCCESS | " << g.nodes[u].id << " | Path Optimized | " << soc << " |\n";
                        break; 
                    }
                }
            }
            if (triggered || found) break;

            if (curr.edge_idx < (int)g.adjacency_list[u].size()) {
                const auto& edge = g.adjacency_list[u][curr.edge_idx];
                curr.edge_idx++;
                
                EdgeCost ec = calculate_edge_costs(u, edge.to, edge, obj, hour, g, ev);
                double total_c = c + ec.scalar_cost;
                double next_soc = ev.enabled ? (soc - ec.energy_kwh) : 0.0;

                if (ev.enabled && next_soc < ev.min_waypoint_soc_kwh) continue;

                if (total_c <= limit) {
                    bool next_dominated = false;
                    if (!ev.enabled) {
                        if (total_c >= min_costs[edge.to]) next_dominated = true;
                    } else {
                        int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                        for (const auto& f : fronts[edge.to]) {
                            if (f.first >= next_soc_bin && f.second <= total_c) { next_dominated = true; break; }
                        }
                    }
                    
                    if (!next_dominated) {
                        if (!ev.enabled) {
                            min_costs[edge.to] = total_c;
                            best_prev[edge.to] = u;
                            s.push({edge.to, total_c, 0.0, -1, 0});
                        } else {
                            int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                            
                            // Pruning
                            auto& f_to = fronts[edge.to];
                            f_to.erase(std::remove_if(f_to.begin(), f_to.end(), [&](const std::pair<int, double>& f){
                                return f.first <= next_soc_bin && f.second >= total_c;
                            }), f_to.end());
                            
                            f_to.push_back({next_soc_bin, total_c});
                            int next_idx = static_cast<int>(pass_states.size());
                            pass_states.push_back({edge.to, curr.state_idx, total_c, next_soc});
                            s.push({edge.to, total_c, next_soc, next_idx, 0});
                        }
                        
                        if (debug_enabled) {
                            oss << "  - Added neighbor: " << g.nodes[edge.to].id << " (" << get_node_name(g.nodes[edge.to]) << ")\n";
                        }
                    }
                } else if (total_c < next_limit) {
                    next_limit = total_c;
                }
            } else { s.pop(); }
        }

        if (triggered || found) {
            if (found) {
                final_prev = best_prev;
                final_states = pass_states;
            }
            break;
        }
        if (next_limit == std::numeric_limits<double>::infinity()) break;
        limit = limit + std::max(next_limit - limit, epsilon);
    }

    auto end_time = std::chrono::steady_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    AlgorithmResult res;
    if (found) {
        if (ev.enabled) {
            res = reconstruct_path_from_states(final_states, final_target_state_idx, "IDDFS", total_nodes_expanded, exec_time, obj, hour, g, ev);
        } else {
            res = reconstruct_path(final_prev, start, end, "IDDFS", total_nodes_expanded, exec_time, obj, hour, g, ev);
        }
    } else {
        res.algorithm = "IDDFS";
        res.nodes_expanded = total_nodes_expanded;
        res.exec_time_ms = exec_time;
    }

    res.debug_logs = debug_enabled ? "(TRUNCATED: Native I/O sinked to disk)" : "";
    res.circuit_breaker_triggered = triggered;
    if (debug_enabled) {
        outfile << oss.str();
        outfile.flush();
        outfile.close();
    }
    if (triggered) {
        res.nodes_expanded = max_nodes + 1;
        res.path.clear();
    }
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
AlgorithmResult run_astar(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, const std::string& output_dir, int kill_time_ms, int debug_node_interval, int max_nodes, double soc_step, double max_speed, const EVParams& ev) {
    auto start_time = std::chrono::steady_clock::now();
    std::ostringstream oss;
    std::ofstream outfile;

    if (debug_enabled && output_dir.empty()) debug_enabled = false;

    if (debug_enabled) {
        outfile.open(output_dir + "/Algo_A*.md");
        outfile << "# A* Debug Log (EV: " << (ev.enabled ? "ON" : "OFF") << ")\n";
        outfile << "- Start: " << start << " (" << get_node_name(g.nodes[start]) << ")\n";
        outfile << "- Target: " << end << " (" << get_node_name(g.nodes[end]) << ")\n";
        outfile << "| Step | Node ID | Cost | SoC |\n|---|---|---|---|\n";
    }

    struct Label {
        double f_score;
        double g_score;
        double soc;
        int u;
        int state_idx; // Index in the 'states' repository
        bool operator>(const Label& other) const { return f_score > other.f_score; }
    };

    std::priority_queue<Label, std::vector<Label>, std::greater<Label>> pq;
    std::vector<SearchState> states; // Repository for EV path reconstruction
    std::vector<std::vector<std::pair<int, double>>> fronts(g.nodes.size()); // (soc_bin, g_score)
    std::vector<double> min_costs(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> prev(g.nodes.size(), -1);
    int nodes_expanded = 0;
    bool triggered = false;
    bool target_found = false;
    int target_state_idx = -1;
    
    double start_soc = ev.enabled ? ev.start_soc_kwh : 0.0;
    double h_start = get_heuristic(start, end, obj, g, max_speed, ev);
    if (ev.enabled) {
        int start_bin = static_cast<int>(std::round(start_soc / soc_step));
        states.push_back({start, -1, 0.0, start_soc});
        pq.push({h_start, 0.0, start_soc, start, 0});
        fronts[start].push_back({start_bin, 0.0});
    } else {
        pq.push({h_start, 0.0, 0.0, start, -1});
        min_costs[start] = 0.0;
    }
    
    while (!pq.empty()) {
        Label curr = pq.top(); pq.pop();
        int u = curr.u;
        double g_u = curr.g_score;
        double s = curr.soc;
        
        if (!ev.enabled) {
            if (g_u > min_costs[u]) continue;
        } else {
            int soc_bin = static_cast<int>(std::round(s / soc_step));
            bool dominated = false;
            for (const auto& f : fronts[u]) {
                if (f.first >= soc_bin && f.second <= g_u) { 
                    if (f.first > soc_bin || f.second < g_u) { dominated = true; break; }
                }
            }
            if (dominated && u != start) continue;
        }

        nodes_expanded++;
        
        if (debug_enabled) {
            oss << "| " << nodes_expanded << " | " << g.nodes[u].id << " | " << g_u << " | " << s << " |\n";
            if (nodes_expanded % debug_node_interval == 0) {
                // Watchdog Check
                auto curr_perf_time = std::chrono::steady_clock::now();
                auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(curr_perf_time - start_time).count();
                if (kill_time_ms > 0 && elapsed_ms > kill_time_ms) {
                    outfile << "| TERMINATED | " << g.nodes[u].id << " | Time Limit Exceeded (" << elapsed_ms << "ms) | - |\n";
                    triggered = true;
                    break;
                }
                // Hardware Sink
                outfile << oss.str();
                outfile.flush();
                oss.str(""); oss.clear();
            }
        }

        if (nodes_expanded > max_nodes) {
            triggered = true;
            if (debug_enabled) {
                oss << "[TERMINATED] **Circuit Breaker Triggered!** | Expanded: " << max_nodes 
                    << " nodes | Last Node: " << g.nodes[u].id << " (" << get_node_name(g.nodes[u]) << ")"
                    << " | Best SoC so far: " << s << "kWh.\n";
            }
            break;
        }

        if (u == end) {
            if (ev.enabled && s < ev.min_arrival_soc_kwh) {
                if (debug_enabled) {
                    oss << "[DEBUG] Goal Node " << g.nodes[u].id << " reached but SoC " << s << " < " << ev.min_arrival_soc_kwh << ". Checking for charging options...\n";
                }
                // Don't 'continue' here, allow charging state expansion below to potentially satisfy SoC.
            } else {
                target_found = true;
                target_state_idx = curr.state_idx;
                break;
            }
        }

        // --- CHARGING STATE EXPANSION (v2.5.0) ---
        if (ev.enabled && g.nodes[u].is_charger && g.nodes[u].is_operational) {
            if (s < ev.target_charge_bound_kwh) {
                double charge_amount = ev.target_charge_bound_kwh - s;
                double kw = g.nodes[u].kw_output;
                if (kw <= 0.0) kw = g.nodes[u].is_emergency_assumption ? 3.0 : 50.0;
                
                double charge_time_s = (charge_amount / kw) * 3600.0;
                double next_g = g_u + charge_time_s;
                double next_soc = ev.target_charge_bound_kwh;
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                
                bool dominated = false;
                for (const auto& f : fronts[u]) {
                    if (f.first >= next_soc_bin && f.second <= next_g) { 
                        if (f.first > next_soc_bin || f.second < next_g) { dominated = true; break; }
                    }
                }
                
                if (!dominated) {
                    auto& f_u = fronts[u];
                    f_u.erase(std::remove_if(f_u.begin(), f_u.end(), [&](const std::pair<int, double>& f){
                        return f.first <= next_soc_bin && f.second >= next_g;
                    }), f_u.end());
                    f_u.push_back({next_soc_bin, next_g});
                    
                    double h = get_heuristic(u, end, obj, g, max_speed, ev); 
                    int next_idx = static_cast<int>(states.size());
                    states.push_back({u, curr.state_idx, next_g, next_soc, true});
                    pq.push({next_g + h, next_g, next_soc, u, next_idx});
                }
            }
        }

        for (const auto& edge : g.adjacency_list[u]) {
            EdgeCost ec = calculate_edge_costs(u, edge.to, edge, obj, hour, g, ev);
            double next_g = g_u + ec.scalar_cost;
            double next_soc = ev.enabled ? (s - ec.energy_kwh) : 0.0;

            if (ev.enabled && next_soc < ev.min_waypoint_soc_kwh) continue;

            bool next_dominated = false;
            if (!ev.enabled) {
                if (next_g >= min_costs[edge.to]) next_dominated = true;
            } else {
                int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                for (const auto& f : fronts[edge.to]) {
                    if (f.first >= next_soc_bin && f.second <= next_g) { next_dominated = true; break; }
                }
            }

            if (!next_dominated) {
                double h = get_heuristic(edge.to, end, obj, g, max_speed, ev);
                if (!ev.enabled) {
                    min_costs[edge.to] = next_g;
                    prev[edge.to] = u;
                    pq.push({next_g + h, next_g, 0.0, edge.to, -1});
                } else {
                    int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                    
                    // Pruning: remove states made obsolete by the new state
                    auto& f_to = fronts[edge.to];
                    f_to.erase(std::remove_if(f_to.begin(), f_to.end(), [&](const std::pair<int, double>& f){
                        return f.first <= next_soc_bin && f.second >= next_g;
                    }), f_to.end());
                    
                    f_to.push_back({next_soc_bin, next_g});
                    int next_idx = static_cast<int>(states.size());
                    states.push_back({edge.to, curr.state_idx, next_g, next_soc});
                    pq.push({next_g + h, next_g, next_soc, edge.to, next_idx});
                }
                
                if (debug_enabled) {
                    oss << "  - Added neighbor: " << g.nodes[edge.to].id << " (" << get_node_name(g.nodes[edge.to]) << ")\n";
                }
            }
        }
    }
    
    auto end_perf_time = std::chrono::steady_clock::now();
    double exec_time = std::chrono::duration<double, std::milli>(end_perf_time - start_time).count();
    AlgorithmResult res;
    if (target_found) {
        if (ev.enabled) {
            res = reconstruct_path_from_states(states, target_state_idx, "A*", nodes_expanded, exec_time, obj, hour, g, ev);
        } else {
            res = reconstruct_path(prev, start, end, "A*", nodes_expanded, exec_time, obj, hour, g, ev);
        }
    } else {
        res.algorithm = "A*";
        res.nodes_expanded = nodes_expanded;
        res.exec_time_ms = exec_time;
    }
    
    res.debug_logs = debug_enabled ? "(TRUNCATED: Native I/O sinked to disk)" : "";
    res.circuit_breaker_triggered = triggered;
    if (debug_enabled) {
        outfile << oss.str();
        outfile.flush();
        outfile.close();
    }
    if (triggered) {
        res.nodes_expanded = max_nodes + 1;
        res.path.clear();
    }
    return res;
}

AlgorithmResult run_idastar_core(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, std::ofstream& outfile, int kill_time_ms, int debug_node_interval, std::chrono::steady_clock::time_point start_perf_time, int max_nodes, double soc_step, double max_speed, double banding_val, std::ostringstream& oss, int& global_expansion, const EVParams& ev) {
    int nodes_expanded = 0;
    bool triggered = false;
    std::vector<int> final_prev(g.nodes.size(), -1);
    std::vector<SearchState> final_states;
    int final_target_state_idx = -1;
    
    struct State {
        int u;
        double g_val;
        double soc;
        int state_idx;
        int edge_idx;
    };

    // (soc_bin, cost) fronts
    std::vector<std::vector<std::pair<int, double>>> fronts(g.nodes.size());
    std::vector<double> min_costs(g.nodes.size(), std::numeric_limits<double>::infinity());
    std::vector<int> best_prev(g.nodes.size(), -1);

    double threshold = get_heuristic(start, end, obj, g, max_speed, ev);
    bool found = false;
    double start_soc = ev.enabled ? ev.start_soc_kwh : 0.0;

    while (true) {
        double min_val = std::numeric_limits<double>::infinity();
        std::vector<SearchState> pass_states;
        // Root-Restart logic for robust IDA* on cyclic road graphs
        if (ev.enabled) {
            int start_bin = static_cast<int>(std::round(start_soc / soc_step));
            fronts.assign(g.nodes.size(), {});
            fronts[start].push_back({start_bin, 0.0});
            pass_states.push_back({start, -1, 0.0, start_soc});
        } else {
            min_costs.assign(g.nodes.size(), std::numeric_limits<double>::infinity());
            min_costs[start] = 0.0;
        }

        std::stack<State> s;
        if (ev.enabled) s.push({start, 0.0, start_soc, 0, 0});
        else s.push({start, 0.0, 0.0, -1, 0});

        while (!s.empty()) {
            State& curr = s.top();
            int u = curr.u;
            double g_curr = curr.g_val;
            double soc_curr = curr.soc;
            double h = get_heuristic(u, end, obj, g, max_speed, ev);
            double f = g_curr + h;

            if (curr.edge_idx == 0) {
                global_expansion++;

                // --- NATIVE WATCHDOG (v2.3.1 - Detached from Debugging) ---
                if (global_expansion % debug_node_interval == 0) {
                    auto curr_perf_time = std::chrono::steady_clock::now();
                    auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(curr_perf_time - start_perf_time).count();
                    if (kill_time_ms > 0 && elapsed_ms > kill_time_ms) {
                        if (debug_enabled) {
                            outfile << "| TERMINATED | " << g.nodes[u].id << " | Time Limit Exceeded (" << elapsed_ms << "ms) | - |\n";
                            outfile.flush();
                        }
                        triggered = true;
                        break;
                    }
                }
                
                if (debug_enabled) {
                    oss << "| " << global_expansion << " | " << g.nodes[u].id << " | " << g_curr << " | " << soc_curr << " |\n";
                    if (global_expansion % debug_node_interval == 0) {
                        // Hardware Sink
                        outfile << oss.str();
                        outfile.flush();
                        oss.str(""); oss.clear();
                    }
                }

                if (global_expansion > max_nodes) {
                    triggered = true;
                    if (debug_enabled) {
                        outfile << "| TERMINATED | " << g.nodes[u].id << " | Circuit Breaker (Nodes) | - |\n";
                    }
                    break;
                }
                
                if (f > threshold) {
                    if (f < min_val) min_val = f;
                    s.pop();
                    continue;
                }

                if (!ev.enabled) {
                    if (g_curr > min_costs[u]) { s.pop(); continue; }
                } else {
                    int soc_bin = static_cast<int>(std::round(soc_curr / soc_step));
                    bool dominated = false;
                    for (const auto& pair : fronts[u]) {
                        if (pair.first >= soc_bin && pair.second <= g_curr) { 
                            if (pair.first > soc_bin || pair.second < g_curr) { dominated = true; break; }
                        }
                    }
                    if (dominated && u != start) { s.pop(); continue; }
                }

                if (u == end) {
                    if (ev.enabled && soc_curr < ev.min_arrival_soc_kwh) {
                        if (debug_enabled) {
                            outfile << "| SEARCHING | " << g.nodes[u].id << " | Found Target (Low SoC) | " << soc_curr << " |\n";
                        }
                    }
                    else { 
                        found = true; 
                        final_target_state_idx = curr.state_idx;
                        if (debug_enabled) outfile << "| SUCCESS | " << g.nodes[u].id << " | Path Optimized | " << soc_curr << " |\n";
                        break; 
                    }
                }
            }
            if (triggered || found) break;

            if (curr.edge_idx < (int)g.adjacency_list[u].size()) {
                const auto& edge = g.adjacency_list[u][curr.edge_idx];
                curr.edge_idx++;
                
                int v = edge.to;
                EdgeCost ec = calculate_edge_costs(u, v, edge, obj, hour, g, ev);
                double next_g = g_curr + ec.scalar_cost;
                double next_soc = ev.enabled ? (soc_curr - ec.energy_kwh) : 0.0;

                if (ev.enabled && next_soc < ev.min_waypoint_soc_kwh) continue;

                bool next_dominated = false;
                if (!ev.enabled) {
                    if (next_g >= min_costs[v]) next_dominated = true;
                } else {
                    int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                    for (const auto& pair : fronts[v]) {
                        if (pair.first >= next_soc_bin && pair.second <= next_g) { next_dominated = true; break; }
                    }
                }

                if (!next_dominated) {
                    if (!ev.enabled) {
                        min_costs[v] = next_g;
                        best_prev[v] = u;
                        s.push({v, next_g, 0.0, -1, 0});
                    } else {
                        int next_soc_bin = static_cast<int>(std::round(next_soc / soc_step));
                        
                        // Pruning
                        auto& f_v = fronts[v];
                        f_v.erase(std::remove_if(f_v.begin(), f_v.end(), [&](const std::pair<int, double>& f){
                            return f.first <= next_soc_bin && f.second >= next_g;
                        }), f_v.end());
                        
                        f_v.push_back({next_soc_bin, next_g});
                        int next_idx = static_cast<int>(pass_states.size());
                        pass_states.push_back({v, curr.state_idx, next_g, next_soc});
                        s.push({v, next_g, next_soc, next_idx, 0});
                    }
                }
            } else { s.pop(); }
        }

        if (triggered || found) {
            if (found) {
                final_prev = best_prev;
                final_states = pass_states;
            }
            break;
        }
        if (min_val == std::numeric_limits<double>::infinity()) break;

        double jump = std::max(banding_val, (min_val - threshold) * 1.5);
        threshold = threshold + jump;
    }
    
    AlgorithmResult res;
    res.algorithm = "IDA*";
    res.nodes_expanded = nodes_expanded;
    res.circuit_breaker_triggered = triggered;
    res.path_cost = std::numeric_limits<double>::infinity();

    if (found) {
        if (ev.enabled) {
            res = reconstruct_path_from_states(final_states, final_target_state_idx, "IDA*", global_expansion, 0, obj, hour, g, ev);
        } else {
            res = reconstruct_path(final_prev, start, end, "IDA*", global_expansion, 0, obj, hour, g, ev);
        }
        res.circuit_breaker_triggered = triggered;
    }

    if (triggered) {
        res.nodes_expanded = max_nodes + 1;
        res.path.clear();
        res.algorithm = "IDA*";
    }
    return res;
}

AlgorithmResult run_idastar(int start, int end, Objective obj, int hour, const Graph& g, bool debug_enabled, const std::string& output_dir, int kill_time_ms, int debug_node_interval, int max_nodes, double soc_step, double banding_shortest, double banding_fastest, const EVParams& ev) {
    if (ev.enabled) {
        AlgorithmResult res;
        res.algorithm = "IDA*";
        res.debug_logs = "IDA* bypassed for EV routing (v2.5.0).";
        return res;
    }
    auto start_time = std::chrono::steady_clock::now();
    std::ostringstream oss;
    std::ofstream outfile;

    if (debug_enabled && output_dir.empty()) debug_enabled = false;

    if (debug_enabled) {
        outfile.open(output_dir + "/Algo_IDA*.md");
        outfile << "# Hybrid IDA* Debug Log (EV: " << (ev.enabled ? "ON" : "OFF") << ")\n";
        outfile << "- Start: " << start << " (" << get_node_name(g.nodes[start]) << ")\n";
        outfile << "- Target: " << end << " (" << get_node_name(g.nodes[end]) << ")\n\n";
        outfile << "| Step | Node ID | Cost | SoC |\n|---|---|---|---|\n";
    }

    double banding_val = (obj == Objective::SHORTEST) ? banding_shortest : banding_fastest;
    double max_speed_global = calculate_max_speed(g);
    
    int global_exp = 0;
    
    // Pass 1: Global Max Speed (Optimistic/Safe)
    AlgorithmResult res1 = run_idastar_core(start, end, obj, hour, g, debug_enabled, outfile, kill_time_ms, debug_node_interval, start_time, max_nodes, soc_step, max_speed_global, banding_val, oss, global_exp, ev);
    if (res1.circuit_breaker_triggered || res1.path.size() > 0) {
        auto current_time = std::chrono::steady_clock::now();
        res1.exec_time_ms = std::chrono::duration<double, std::milli>(current_time - start_time).count();
        res1.debug_logs = debug_enabled ? "(TRUNCATED: Native I/O sinked to disk)" : "";
        if (debug_enabled) {
            outfile << oss.str();
            outfile.flush();
            outfile.close();
        }
        return res1;
    }
    
    // Pass 2: Conservative Max Speed
    double max_speed_conservative = std::max(30.0, max_speed_global * 0.5);
    AlgorithmResult res2 = run_idastar_core(start, end, obj, hour, g, debug_enabled, outfile, kill_time_ms, debug_node_interval, start_time, max_nodes, soc_step, max_speed_conservative, banding_val, oss, global_exp, ev);
    
    AlgorithmResult best_res;
    if (res1.path_cost < res2.path_cost) best_res = res1;
    else best_res = res2;

    auto end_time = std::chrono::steady_clock::now();
    best_res.exec_time_ms = std::chrono::duration<double, std::milli>(end_time - start_time).count();
    best_res.debug_logs = debug_enabled ? "(TRUNCATED: Native I/O sinked to disk)" : "";
    best_res.nodes_expanded = global_exp;
    best_res.algorithm = "IDA*";
    
    if (debug_enabled) {
        outfile << oss.str();
        outfile.flush();
        outfile.close();
    }
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
    const std::string& output_dir,
    int kill_time_ms,
    int debug_node_interval,
    const std::string& region_id,
    bool cache_evict,
    const std::vector<std::tuple<int, double, double, std::string, double, double, bool, std::string, double, bool, bool>>& dyn_nodes,
    const std::vector<std::tuple<int, int, double, int, std::string>>& dyn_edges,
    int max_nodes,
    double soc_discretization_step,
    double banding_shortest,
    double banding_fastest,
    double epsilon_min,
    const EVParams& ev
) {
    int cache_max = get_cache_max_size();

    // ── Manual Cache Eviction ─────────────────────────────────────────────────
    if (cache_evict) {
        std::lock_guard<std::mutex> lock(s_graph_cache_mutex);
        cache_clear_locked();
    }

    // ── FAST PATH: Cache Lookup ───────────────────────────────────────────────
    if (!region_id.empty()) {
        std::unique_lock<std::mutex> lock(s_graph_cache_mutex);
        auto it = s_graph_cache.find(region_id);
        if (it != s_graph_cache.end()) {
            // CACHE HIT: promote to MRU position
            s_lru_order.erase(it->second.second);
            s_lru_order.push_front(region_id);
            it->second.second = s_lru_order.begin();

            std::shared_ptr<const Graph> cached_g_ptr = it->second.first.graph;
            double cached_max_speed = it->second.first.max_speed;

            // Release lock before starting searches to avoid thread starvation
            lock.unlock();

            int start_idx = find_nearest_node(start_lat, start_lng, *cached_g_ptr);
            int end_idx = find_nearest_node(end_lat, end_lng, *cached_g_ptr);
            Objective objective = static_cast<Objective>(objective_val);

            // Island Detection Check
            if (cached_g_ptr->nodes[start_idx].component_id != cached_g_ptr->nodes[end_idx].component_id) {
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

            // Launch algorithms using lambdas that capture shared_ptr BY VALUE to keep Graph alive.
            auto launch = [&](auto func, int s, int e, auto... args) {
                return std::async(std::launch::async, [=, g_ptr = cached_g_ptr] {
                    return func(s, e, objective, mock_hour, *g_ptr, algo_debug, output_dir, kill_time_ms, debug_node_interval, max_nodes, soc_discretization_step, args...);
                });
            };

            auto f_bfs = launch(run_bfs, start_idx, end_idx, ev);
            auto f_dijkstra = launch(run_dijkstra, start_idx, end_idx, ev);
            auto f_iddfs = launch(run_iddfs, start_idx, end_idx, epsilon_min, ev);
            auto f_astar = launch(run_astar, start_idx, end_idx, cached_max_speed, ev);
            auto f_idastar = launch(run_idastar, start_idx, end_idx, banding_shortest, banding_fastest, ev);

            return {f_bfs.get(), f_dijkstra.get(), f_iddfs.get(), f_astar.get(), f_idastar.get()};
        }
    }

    // ── SLOW PATH: Graph Build ────────────────────────────────────────────────
    Graph g;
    if (dyn_nodes.empty()) {
        g = get_static_graph();
    } else {
        // Build dynamic graph with Stage 5 Data
        for (const auto& dn : dyn_nodes) {
            Node n;
            n.id = std::get<0>(dn);
            n.lat = std::get<1>(dn);
            n.lng = std::get<2>(dn);
            n.name = std::get<3>(dn);
            n.elevation = std::get<4>(dn);
            n.elevation_confidence = std::get<5>(dn);
            n.is_charger = std::get<6>(dn);
            n.charger_type = std::get<7>(dn);
            n.kw_output = std::get<8>(dn);
            n.is_operational = std::get<9>(dn);
            n.is_emergency_assumption = std::get<10>(dn);
            g.nodes.push_back(n);
        }
        g.adjacency_list.resize(g.nodes.size());
        for (const auto& de : dyn_edges) {
            int u = std::get<0>(de);
            int v = std::get<1>(de);
            double dist = std::get<2>(de);
            int speed = std::get<3>(de);
            std::string type = std::get<4>(de);

            // NAN/INF Weight Validation
            if (!std::isfinite(dist) || dist < 0) dist = 999999.0; 

            if (static_cast<size_t>(u) < g.nodes.size() && static_cast<size_t>(v) < g.nodes.size()) {
                g.adjacency_list[u].push_back({v, dist, speed, type});
            }
        }
    }

    compute_components(g); // Pre-process for Island Detection
    double max_speed = calculate_max_speed(g);

    auto graph_ptr = std::make_shared<Graph>(std::move(g));

    // Store in cache if region_id provided
    if (!region_id.empty()) {
        std::lock_guard<std::mutex> lock(s_graph_cache_mutex);
        cache_insert(region_id, graph_ptr, max_speed, cache_max);
    }

    int start_idx = find_nearest_node(start_lat, start_lng, *graph_ptr);
    int end_idx = find_nearest_node(end_lat, end_lng, *graph_ptr);
    Objective objective = static_cast<Objective>(objective_val);

    // Island Detection Check
    if (graph_ptr->nodes[start_idx].component_id != graph_ptr->nodes[end_idx].component_id) {
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

    // Launch algorithms using lambdas that capture shared_ptr BY VALUE to keep Graph alive.
    auto launch = [&](auto func, int s, int e, auto... args) {
        return std::async(std::launch::async, [=, g_ptr = graph_ptr] {
            return func(s, e, objective, mock_hour, *g_ptr, algo_debug, output_dir, kill_time_ms, debug_node_interval, max_nodes, soc_discretization_step, args...);
        });
    };

    auto f_bfs = launch(run_bfs, start_idx, end_idx, ev);
    auto f_dijkstra = launch(run_dijkstra, start_idx, end_idx, ev);
    auto f_iddfs = launch(run_iddfs, start_idx, end_idx, epsilon_min, ev);
    auto f_astar = launch(run_astar, start_idx, end_idx, max_speed, ev);
    auto f_idastar = launch(run_idastar, start_idx, end_idx, banding_shortest, banding_fastest, ev);

    return {f_bfs.get(), f_dijkstra.get(), f_iddfs.get(), f_astar.get(), f_idastar.get()};
}

std::vector<RoutePoint> calculate_dummy_route(double start_lat, double start_lng, double end_lat, double end_lng) {
    return {
        {start_lat, start_lng, 0.0},
        {start_lat + 0.01, start_lng + 0.01, 0.0},
        {end_lat - 0.01, end_lng - 0.01, 0.0},
        {end_lat, end_lng, 0.0}
    };
}
