/**
 * @fileoverview Canonically maps OCM ConnectionTypeIDs to AI Route Planner Protobuf PortType Enums.
 * 
 * Standard IDs from OpenChargeMap:
 * 1 -> Type 1 (J1772)
 * 2 -> Type 2 (Mennekes)
 * 3 -> CCS Type 1
 * 4 -> CCS Type 2
 * 30 -> Tesla Supercharger
 * 1036 -> Bharat DC (Common in India)
 * 1042 -> Wall Plug / Domestic
 */

const PORT_TYPE_MAP = {
    // Stage 5 Canonical Enums (matching route_engine.proto)
    1: 'CCS1',
    2: 'IEC_62196_T2',
    3: 'CCS1',
    33: 'CCS1',
    4: 'CCS2',
    30: 'TESLA_S',
    31: 'TESLA_S',
    1036: 'BHARAT_DC',
    1042: 'WALL_PLUG',
    25: 'CHADEMO',
    32: 'CHADEMO'
};

/**
 * Translates a collection of OCM Connection IDs into standardized PortType strings.
 * 
 * DESIGN PRINCIPLE:
 * Fallback to 'UNKNOWN_PORT' (enum 0) ensures that unrecognized OCM data does 
 * not break gRPC serialization in the Routing Engine.
 * 
 * @param {Array<number>} connectionIds - Raw OCM connection Type IDs.
 * @returns {Array<string>} Deduped canonical PortType enums.
 */
const mapPorts = (connectionIds = []) => {
    if (!Array.isArray(connectionIds)) return [];
    
    const ports = connectionIds
        .map(id => PORT_TYPE_MAP[id] || 'UNKNOWN_PORT');

    return [...new Set(ports)]; // Return unique ports including fallback for unknown IDs
};

module.exports = {
    mapPorts,
    PORT_TYPE_MAP
};
