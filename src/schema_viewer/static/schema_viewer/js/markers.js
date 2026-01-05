/**
 * ER Diagram Marker Definitions and Utilities
 * Handles crow's foot notation for relationship visualization
 */

const Markers = {
    // Colors matching CSS variables
    colors: {
        fk: '#3b82f6',   // blue
        o2o: '#8b5cf6',  // purple
        m2m: '#10b981',  // green
    },

    // Marker size configuration
    size: 10,
    // How much markers overlap with node edge (pixels)
    overlap: 0,

    /**
     * Generate SVG marker definitions
     * All markers use consistent sizing (10x10 viewBox)
     *
     * refX positioning with overlap:
     * - Left markers: refX > rightmost content to push marker into node
     * - Right markers: refX < leftmost content to push marker into node
     */
    getDefinitions() {
        const { fk, o2o, m2m } = this.colors;
        const s = this.size;
        const mid = s / 2;
        const o = this.overlap; // overlap offset

        return `
            <defs>
                <!-- Crow's foot (many) - prongs point left, attaches to left side of node -->
                <marker id="crow-left" viewBox="0 0 ${s} ${s}" refX="${s + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <path d="M ${s} 0 L 0 ${mid} L ${s} ${s}" stroke="${fk}" stroke-width="1.5" fill="none"/>
                </marker>

                <!-- Crow's foot (many) - prongs point right, attaches to right side of node -->
                <marker id="crow-right" viewBox="0 0 ${s} ${s}" refX="${-o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <path d="M 0 0 L ${s} ${mid} L 0 ${s}" stroke="${fk}" stroke-width="1.5" fill="none"/>
                </marker>

                <!-- One (single bar) - centered on node edge -->
                <marker id="one-left" viewBox="0 0 ${s} ${s}" refX="${mid + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="${mid}" y1="1" x2="${mid}" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                </marker>

                <marker id="one-right" viewBox="0 0 ${s} ${s}" refX="${mid - o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="${mid}" y1="1" x2="${mid}" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                </marker>

                <!-- One-and-only-one (double bar) - inner bar at node edge -->
                <marker id="one-only-left" viewBox="0 0 ${s} ${s}" refX="${7 + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="3" y1="1" x2="3" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                    <line x1="7" y1="1" x2="7" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                </marker>

                <marker id="one-only-right" viewBox="0 0 ${s} ${s}" refX="${3 - o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="3" y1="1" x2="3" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                    <line x1="7" y1="1" x2="7" y2="${s - 1}" stroke="${fk}" stroke-width="2"/>
                </marker>

                <!-- O2O markers (purple) -->
                <marker id="o2o-one-left" viewBox="0 0 ${s} ${s}" refX="${mid + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="${mid}" y1="1" x2="${mid}" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                </marker>
                <marker id="o2o-one-right" viewBox="0 0 ${s} ${s}" refX="${mid - o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="${mid}" y1="1" x2="${mid}" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                </marker>
                <marker id="o2o-only-left" viewBox="0 0 ${s} ${s}" refX="${7 + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="3" y1="1" x2="3" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                    <line x1="7" y1="1" x2="7" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                </marker>
                <marker id="o2o-only-right" viewBox="0 0 ${s} ${s}" refX="${3 - o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <line x1="3" y1="1" x2="3" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                    <line x1="7" y1="1" x2="7" y2="${s - 1}" stroke="${o2o}" stroke-width="2"/>
                </marker>

                <!-- M2M markers (green) -->
                <marker id="m2m-left" viewBox="0 0 ${s} ${s}" refX="${s + o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <path d="M ${s} 0 L 0 ${mid} L ${s} ${s}" stroke="${m2m}" stroke-width="1.5" fill="none"/>
                </marker>
                <marker id="m2m-right" viewBox="0 0 ${s} ${s}" refX="${-o}" refY="${mid}"
                        markerWidth="${s}" markerHeight="${s}" orient="0">
                    <path d="M 0 0 L ${s} ${mid} L 0 ${s}" stroke="${m2m}" stroke-width="1.5" fill="none"/>
                </marker>
            </defs>
        `;
    },

    /**
     * Get which side of node the line exits from
     * @param {Object} from - Start point {x, y}
     * @param {Object} to - End point {x, y}
     * @returns {string} 'left' or 'right' - which side of the node the line exits
     */
    getExitSide(from, to) {
        // If line goes right, it exits the RIGHT side of the node
        // If line goes left, it exits the LEFT side of the node
        return to.x >= from.x ? 'right' : 'left';
    },

    /**
     * Get appropriate markers for a relationship path
     * Marker prongs point TOWARD their attached node:
     * - crow-right attaches to RIGHT side (prongs point right, toward node)
     * - crow-left attaches to LEFT side (prongs point left, toward node)
     *
     * @param {Array} points - Array of {x, y} points defining the path
     * @param {string} relType - Relationship type: 'foreign_key', 'one_to_one', 'many_to_many'
     * @returns {Object} { start: string, end: string } marker URLs
     */
    getMarkersForPath(points, relType) {
        if (!points || points.length < 2) {
            return { start: '', end: '' };
        }

        // START marker: which side does the line exit from at source?
        // If going right → exits RIGHT side → use right marker (prongs point right toward source)
        // If going left → exits LEFT side → use left marker (prongs point left toward source)
        const startExitSide = this.getExitSide(points[0], points[1]);
        const startMarkerDir = startExitSide;

        // END marker: which side does the line enter at target?
        // If coming from left (path going right) → enters LEFT side → use left marker
        // If coming from right (path going left) → enters RIGHT side → use right marker
        // This is the OPPOSITE of the path direction!
        const endPathDir = this.getExitSide(points[points.length - 2], points[points.length - 1]);
        const endMarkerDir = endPathDir === 'right' ? 'left' : 'right';

        switch (relType) {
            case 'foreign_key':
                // Many (crow's foot) at source, one-and-only-one at target
                return {
                    start: `url(#crow-${startMarkerDir})`,
                    end: `url(#one-only-${endMarkerDir})`,
                };

            case 'one_to_one':
                // One at source, one-and-only-one at target
                return {
                    start: `url(#o2o-one-${startMarkerDir})`,
                    end: `url(#o2o-only-${endMarkerDir})`,
                };

            case 'many_to_many':
                // Many (crow's foot) at both ends
                return {
                    start: `url(#m2m-${startMarkerDir})`,
                    end: `url(#m2m-${endMarkerDir})`,
                };

            default:
                return { start: '', end: '' };
        }
    },
};

window.Markers = Markers;
