/**
 * Graph layout and orthogonal edge routing for Django Schema Viewer
 * Uses a hub-and-spoke layout centered on the most connected node
 */

const Layout = {
    config: {
        nodeWidth: 220,
        horizontalGap: 150,
        verticalGap: 100,
    },

    // Scoring weights for path selection
    scoreWeights: {
        length: 1,        // Cost per pixel of path length
        turn: 50,         // Cost per 90-degree turn
        crossing: 200,    // Cost per line crossing
        nodeTouch: 500,   // Cost per node intersection
    },

    /**
     * Calculate grid layout with intelligent row/column placement
     * Rules:
     * - Columns based on dependency depth
     * - Multi-connected nodes share rows with nodes they connect to
     * - Single-connected nodes can be placed flexibly
     */
    calculateHierarchicalLayout(schema, nodeHeights) {
        const nodeMap = new Map();
        const edges = new Set();

        // Build node map
        for (const [appLabel, appData] of Object.entries(schema.apps)) {
            for (const [modelName, model] of Object.entries(appData.models)) {
                const key = `${appLabel}.${modelName}`;
                nodeMap.set(key, {
                    key,
                    appLabel,
                    modelName,
                    model,
                    height: nodeHeights[key] || 180,
                    connections: new Set(),
                    outgoing: new Set(),
                    incoming: new Set(),
                    hasSelfConnection: false,
                });
            }
        }

        // Build edges and connections
        for (const [key, node] of nodeMap) {
            for (const rel of node.model.relationships || []) {
                if (rel.direction !== 'forward') continue;
                const targetKey = `${rel.target_app}.${rel.target_model}`;

                // Check for self-connection
                if (targetKey === key) {
                    node.hasSelfConnection = true;
                    continue;
                }

                if (nodeMap.has(targetKey)) {
                    const edgeKey = `${key}|${targetKey}|${rel.name}`;
                    if (!edges.has(edgeKey)) {
                        edges.add(edgeKey);
                    }
                    node.connections.add(targetKey);
                    node.outgoing.add(targetKey);
                    nodeMap.get(targetKey).connections.add(key);
                    nodeMap.get(targetKey).incoming.add(key);
                }
            }
        }

        // Convert edge keys to edge objects
        const edgeList = [...edges].map(edgeKey => {
            const [source, target, relName] = edgeKey.split('|');
            const sourceNode = nodeMap.get(source);
            const rel = sourceNode.model.relationships.find(r =>
                r.direction === 'forward' && r.name === relName &&
                `${r.target_app}.${r.target_model}` === target
            );
            return { source, target, rel };
        });

        // Calculate columns (depth) for each node
        const columns = new Map(); // node key -> column index
        const processed = new Set();

        // Base nodes (no outgoing) go in column 0
        for (const [key, node] of nodeMap) {
            if (node.outgoing.size === 0) {
                columns.set(key, 0);
                processed.add(key);
            }
        }

        // If no base nodes, pick most referenced
        if (processed.size === 0) {
            const sorted = [...nodeMap.entries()]
                .sort((a, b) => b[1].incoming.size - a[1].incoming.size);
            if (sorted.length > 0) {
                columns.set(sorted[0][0], 0);
                processed.add(sorted[0][0]);
            }
        }

        // Propagate columns
        let changed = true;
        while (changed) {
            changed = false;
            for (const [key, node] of nodeMap) {
                if (processed.has(key)) continue;

                let allDepsProcessed = true;
                let maxCol = -1;

                for (const target of node.outgoing) {
                    if (!columns.has(target)) {
                        allDepsProcessed = false;
                        break;
                    }
                    maxCol = Math.max(maxCol, columns.get(target));
                }

                if (allDepsProcessed && node.outgoing.size > 0) {
                    columns.set(key, maxCol + 1);
                    processed.add(key);
                    changed = true;
                }
            }
        }

        // Remaining nodes (cycles/disconnected) go to column 0
        for (const key of nodeMap.keys()) {
            if (!columns.has(key)) {
                columns.set(key, 0);
            }
        }

        // Group nodes by column
        const columnGroups = new Map();
        for (const [key, col] of columns) {
            if (!columnGroups.has(col)) {
                columnGroups.set(col, []);
            }
            columnGroups.get(col).push(key);
        }

        const sortedCols = [...columnGroups.keys()].sort((a, b) => a - b);

        // Assign rows using the grid rules
        const rows = new Map(); // node key -> row index
        const gridOccupied = new Set(); // "col,row" strings for occupied cells

        // Helper: check if a grid cell is free
        const isCellFree = (col, row) => !gridOccupied.has(`${col},${row}`);

        // Helper: check if a node can be placed in a row
        const canPlaceInRow = (nodeKey, row, col) => {
            // First check: is this grid cell already taken?
            if (!isCellFree(col, row)) return false;

            const node = nodeMap.get(nodeKey);
            const connectionCount = node.connections.size;

            // Get nodes already in this row (from other columns)
            const nodesInRow = [...rows.entries()]
                .filter(([k, r]) => r === row)
                .map(([k]) => k);

            if (nodesInRow.length === 0) return true;

            // Single-connection nodes: can go in row if their connection is
            // in adjacent column OR not in this row
            if (connectionCount <= 1) {
                const connectedTo = [...node.connections][0];
                if (!connectedTo) return true;

                const connectedCol = columns.get(connectedTo);
                const isAdjacent = Math.abs(connectedCol - col) === 1;
                const connectedInThisRow = rows.get(connectedTo) === row;

                // Can place if connection is adjacent OR connection is not in this row
                return isAdjacent || !connectedInThisRow;
            }

            // Multi-connection nodes: can only be in row with nodes that connect to it
            // or have self-connections
            for (const otherKey of nodesInRow) {
                const other = nodeMap.get(otherKey);
                const connectedToThis = node.connections.has(otherKey);
                const hasSelf = other.hasSelfConnection || node.hasSelfConnection;

                if (!connectedToThis && !hasSelf) {
                    return false;
                }
            }

            return true;
        };

        // Helper: find best row for a node
        const findBestRow = (nodeKey, col) => {
            const node = nodeMap.get(nodeKey);

            // Try to find a row where connected nodes already exist
            for (const connectedKey of node.connections) {
                if (rows.has(connectedKey)) {
                    const connectedRow = rows.get(connectedKey);
                    if (canPlaceInRow(nodeKey, connectedRow, col)) {
                        return connectedRow;
                    }
                }
            }

            // Find first available row
            for (let r = 0; r < nodeMap.size; r++) {
                if (canPlaceInRow(nodeKey, r, col)) {
                    return r;
                }
            }

            // Fallback: new row
            return rows.size > 0 ? Math.max(...rows.values()) + 1 : 0;
        };

        // Process columns from left to right, placing nodes in rows
        for (const col of sortedCols) {
            const nodesInCol = columnGroups.get(col);

            // Sort nodes: multi-connected first, then by connection count
            nodesInCol.sort((a, b) => {
                const aNode = nodeMap.get(a);
                const bNode = nodeMap.get(b);
                return bNode.connections.size - aNode.connections.size;
            });

            for (const nodeKey of nodesInCol) {
                const row = findBestRow(nodeKey, col);
                rows.set(nodeKey, row);
                gridOccupied.add(`${col},${row}`);
            }
        }

        // Compact rows (remove gaps)
        const usedRows = new Set(rows.values());
        const sortedUsedRows = [...usedRows].sort((a, b) => a - b);
        const rowMapping = new Map();
        sortedUsedRows.forEach((oldRow, newRow) => {
            rowMapping.set(oldRow, newRow);
        });

        for (const [key, row] of rows) {
            rows.set(key, rowMapping.get(row));
        }

        // Calculate positions from grid
        const positions = new Map();
        const { nodeWidth, horizontalGap, verticalGap } = this.config;

        // Calculate row heights (max node height in each row)
        const rowHeights = new Map();
        for (const [key, row] of rows) {
            const height = nodeHeights[key] || 180;
            rowHeights.set(row, Math.max(rowHeights.get(row) || 0, height));
        }

        // Calculate Y positions for each row
        const rowYPositions = new Map();
        let currentY = 50;
        const maxRow = Math.max(...rows.values());
        for (let r = 0; r <= maxRow; r++) {
            rowYPositions.set(r, currentY);
            currentY += (rowHeights.get(r) || 180) + verticalGap;
        }

        // Calculate X positions for each column
        const colXPositions = new Map();
        let currentX = 50;
        for (const col of sortedCols) {
            colXPositions.set(col, currentX);
            currentX += nodeWidth + horizontalGap;
        }

        // Set final positions
        for (const [key, col] of columns) {
            const row = rows.get(key);
            positions.set(key, {
                x: colXPositions.get(col),
                y: rowYPositions.get(row),
            });
        }

        // Find hub node for reference
        let hubNode = null;
        let maxConnections = -1;
        for (const [key, node] of nodeMap) {
            if (node.connections.size > maxConnections) {
                maxConnections = node.connections.size;
                hubNode = node;
            }
        }

        return { positions, nodeMap, edges: edgeList, hubNode };
    },

    /**
     * Check if a horizontal segment intersects any node (excluding source/target)
     */
    segmentIntersectsNode(x1, x2, y, nodeBounds, excludeKeys, padding = 10) {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);

        for (const [key, bounds] of Object.entries(nodeBounds)) {
            if (excludeKeys.includes(key)) continue;

            // Check if the horizontal line at y intersects this node
            if (y > bounds.top - padding && y < bounds.bottom + padding) {
                // Y is within node's vertical range
                if (maxX > bounds.left - padding && minX < bounds.right + padding) {
                    // X range overlaps with node
                    return { key, bounds };
                }
            }
        }
        return null;
    },

    /**
     * Check if a vertical segment intersects any node
     */
    verticalSegmentIntersectsNode(y1, y2, x, nodeBounds, excludeKeys, padding = 10) {
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        for (const [key, bounds] of Object.entries(nodeBounds)) {
            if (excludeKeys.includes(key)) continue;

            if (x > bounds.left - padding && x < bounds.right + padding) {
                if (maxY > bounds.top - padding && minY < bounds.bottom + padding) {
                    return { key, bounds };
                }
            }
        }
        return null;
    },

    /**
     * Get Y offset for a specific field within a node
     * Header is ~50px, padding 8px, each field row ~28px
     */
    getFieldYOffset(model, fieldName) {
        const fields = (model.fields || []).slice(0, 5);
        // Look for the field by name (FK fields might be named "author" but stored as "author_id")
        const fieldIndex = fields.findIndex(f =>
            f.name === fieldName ||
            f.name === fieldName + '_id' ||
            f.name.replace('_id', '') === fieldName
        );

        if (fieldIndex >= 0) {
            // Header(50) + padding(8) + fields before this one + center of this field
            return 50 + 8 + (fieldIndex * 28) + 14;
        }
        // Field not visible, connect to middle of fields area
        return 50 + 8 + 14;
    },

    /**
     * Get Y offset for the PK field (usually first field)
     */
    getPkYOffset(model) {
        const fields = (model.fields || []).slice(0, 5);
        const pkIndex = fields.findIndex(f => f.primary_key);
        if (pkIndex >= 0) {
            return 50 + 8 + (pkIndex * 28) + 14;
        }
        // Default to first field
        return 50 + 8 + 14;
    },

    /**
     * Count the number of turns (direction changes) in a path
     * @param {Array} points - Array of {x, y} points
     * @returns {number} Number of turns
     */
    countTurns(points) {
        if (points.length < 3) return 0;

        let turns = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            // Check if direction changes
            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;

            // If horizontal becomes vertical or vice versa, it's a turn
            const wasHorizontal = Math.abs(dx1) > Math.abs(dy1);
            const nowHorizontal = Math.abs(dx2) > Math.abs(dy2);

            if (wasHorizontal !== nowHorizontal) {
                turns++;
            }
        }
        return turns;
    },

    /**
     * Check if two line segments intersect
     * @param {Object} p1 - Start of segment 1 {x, y}
     * @param {Object} p2 - End of segment 1 {x, y}
     * @param {Object} p3 - Start of segment 2 {x, y}
     * @param {Object} p4 - End of segment 2 {x, y}
     * @returns {boolean} True if segments intersect
     */
    segmentsIntersect(p1, p2, p3, p4) {
        // Using cross product method
        const ccw = (A, B, C) => {
            return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
        };

        // Check if segments share an endpoint (not a real crossing)
        const samePoint = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
        if (samePoint(p1, p3) || samePoint(p1, p4) || samePoint(p2, p3) || samePoint(p2, p4)) {
            return false;
        }

        return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
    },

    /**
     * Count how many times a path crosses existing routes
     * @param {Array} points - The candidate path points
     * @param {Array} existingRoutes - Array of already-placed routes
     * @returns {number} Number of crossings
     */
    countCrossings(points, existingRoutes) {
        let crossings = 0;

        // For each segment in the candidate path
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Check against each segment in existing routes
            for (const route of existingRoutes) {
                for (let j = 0; j < route.points.length - 1; j++) {
                    const p3 = route.points[j];
                    const p4 = route.points[j + 1];

                    if (this.segmentsIntersect(p1, p2, p3, p4)) {
                        crossings++;
                    }
                }
            }
        }

        return crossings;
    },

    /**
     * Calculate path length
     * @param {Array} points - Array of {x, y} points
     * @returns {number} Total path length
     */
    calculatePathLength(points) {
        let length = 0;
        for (let i = 0; i < points.length - 1; i++) {
            const dx = points[i + 1].x - points[i].x;
            const dy = points[i + 1].y - points[i].y;
            length += Math.abs(dx) + Math.abs(dy); // Manhattan distance for orthogonal paths
        }
        return length;
    },

    /**
     * Count how many nodes a path passes through
     * @param {Array} points - The candidate path points
     * @param {Map} nodeBounds - Map of node keys to bounds
     * @param {Set} excludeKeys - Nodes to exclude (source and target)
     * @returns {number} Number of node intersections
     */
    countNodeTouches(points, nodeBounds, excludeKeys) {
        let touches = 0;

        for (const [key, bounds] of nodeBounds) {
            if (excludeKeys.has(key)) continue;

            // Check each segment of the path
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];

                // Check if segment intersects this node's bounds
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);
                const minY = Math.min(p1.y, p2.y);
                const maxY = Math.max(p1.y, p2.y);

                // Check for overlap with node bounds
                if (maxX > bounds.left && minX < bounds.right &&
                    maxY > bounds.top && minY < bounds.bottom) {
                    touches++;
                    break; // Only count each node once per path
                }
            }
        }

        return touches;
    },

    /**
     * Score a path based on length, turns, crossings, and node touches
     * Lower score is better
     * @param {Array} points - The path points
     * @param {Array} existingRoutes - Already-placed routes for crossing detection
     * @param {Map} nodeBounds - Map of node keys to bounds
     * @param {Set} excludeKeys - Nodes to exclude from touch detection
     * @returns {number} The path score
     */
    scorePath(points, existingRoutes, nodeBounds, excludeKeys) {
        const length = this.calculatePathLength(points);
        const turns = this.countTurns(points);
        const crossings = this.countCrossings(points, existingRoutes);
        const nodeTouches = nodeBounds ? this.countNodeTouches(points, nodeBounds, excludeKeys) : 0;

        return (
            length * this.scoreWeights.length +
            turns * this.scoreWeights.turn +
            crossings * this.scoreWeights.crossing +
            nodeTouches * this.scoreWeights.nodeTouch
        );
    },

    /**
     * Calculate orthogonal edge routes
     * @param {Map} positions - Map of node keys to {x, y} positions
     * @param {Array} edges - Array of edge objects
     * @param {Object} nodeHeights - Object mapping node keys to heights
     * @param {Map} nodeMap - Map of node keys to node data
     */
    calculateEdgeRoutes(positions, edges, nodeHeights, nodeMap) {
        const routes = [];
        const { nodeWidth } = this.config;

        // Track connection offsets per target node to spread out overlapping markers
        const connectionOffsets = new Map();
        const offsetStep = 12; // Pixels between overlapping connections

        // Build bounding boxes as a Map
        const nodeBounds = new Map();
        for (const [key, pos] of positions) {
            const height = nodeHeights[key] || 180;
            nodeBounds.set(key, {
                left: pos.x,
                right: pos.x + nodeWidth,
                top: pos.y,
                bottom: pos.y + height,
                centerX: pos.x + nodeWidth / 2,
                centerY: pos.y + height / 2,
            });
        }

        // Process each edge - connect at specific field positions
        for (const edge of edges) {
            // Skip self-referential edges - they're rendered separately in canvas.js
            if (edge.source === edge.target) continue;

            const sBounds = nodeBounds.get(edge.source);
            const tBounds = nodeBounds.get(edge.target);
            if (!sBounds || !tBounds) continue;

            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            if (!sourceNode || !targetNode) continue;

            // Get field Y offsets
            const sourceFieldY = sBounds.top + this.getFieldYOffset(sourceNode.model, edge.rel.name);
            const targetFieldY = tBounds.top + this.getPkYOffset(targetNode.model);

            // Apply offset to spread out overlapping connections
            // Use a simple counter per target node to offset each incoming connection
            const targetOffsetKey = `${edge.target}:target`;
            const targetCount = connectionOffsets.get(targetOffsetKey) || 0;
            connectionOffsets.set(targetOffsetKey, targetCount + 1);

            // Count total incoming edges to this target (excluding self-referential)
            const totalIncoming = edges.filter(e => e.target === edge.target && e.source !== e.target).length;
            const targetCenterOffset = (totalIncoming - 1) / 2;
            const targetOffset = (targetCount - targetCenterOffset) * offsetStep;

            const excludeKeys = new Set([edge.source, edge.target]);

            // Find all obstacles between source and target
            const obstacles = [];
            for (const [key, bounds] of nodeBounds) {
                if (excludeKeys.has(key)) continue;
                obstacles.push({ key, bounds });
            }

            const startY = sourceFieldY;
            const endY = targetFieldY + targetOffset;

            // Calculate the leftmost and rightmost edges of all nodes
            let leftmostEdge = Math.min(sBounds.left, tBounds.left);
            let rightmostEdge = Math.max(sBounds.right, tBounds.right);

            for (const { bounds } of obstacles) {
                leftmostEdge = Math.min(leftmostEdge, bounds.left);
                rightmostEdge = Math.max(rightmostEdge, bounds.right);
            }

            const routeLeftX = leftmostEdge - 40;
            const routeRightX = rightmostEdge + 40;

            // Helper to check if a horizontal segment intersects any obstacle
            const horizontalSegmentBlocked = (x1, x2, y) => {
                const minX = Math.min(x1, x2);
                const maxX = Math.max(x1, x2);
                return obstacles.some(({ bounds }) =>
                    y >= bounds.top && y <= bounds.bottom &&
                    maxX > bounds.left && minX < bounds.right
                );
            };

            // Helper to check if a vertical segment intersects any obstacle
            const verticalSegmentBlocked = (y1, y2, x) => {
                const minY = Math.min(y1, y2);
                const maxY = Math.max(y1, y2);
                return obstacles.some(({ bounds }) =>
                    x >= bounds.left && x <= bounds.right &&
                    maxY > bounds.top && minY < bounds.bottom
                );
            };

            // Generate all possible route options
            // Try all 4 side combinations: source left/right × target left/right
            // Constraint: paths must exit in the direction of the side they connect to
            // - Right side exit must go rightward (midX >= srcX)
            // - Left side exit must go leftward (midX <= srcX)
            // - Right side entry must come from right (midX >= tgtX)
            // - Left side entry must come from left (midX <= tgtX)
            const routeOptions = [];

            const sideCombos = [
                { srcX: sBounds.right, tgtX: tBounds.left, srcDir: 'right', tgtDir: 'left' },
                { srcX: sBounds.right, tgtX: tBounds.right, srcDir: 'right', tgtDir: 'right' },
                { srcX: sBounds.left, tgtX: tBounds.left, srcDir: 'left', tgtDir: 'left' },
                { srcX: sBounds.left, tgtX: tBounds.right, srcDir: 'left', tgtDir: 'right' },
            ];

            for (const { srcX, tgtX, srcDir, tgtDir } of sideCombos) {
                // Helper to check if midX is valid for the source direction
                const validForSource = (midX) => {
                    return srcDir === 'right' ? midX >= srcX : midX <= srcX;
                };

                // Helper to check if midX is valid for the target direction
                const validForTarget = (midX) => {
                    return tgtDir === 'left' ? midX <= tgtX : midX >= tgtX;
                };

                // Route 1: Direct path through midpoint (only if directions allow)
                // Ensure minimum horizontal distance to avoid degenerate vertical-only paths
                const minHorizontalDist = 20;
                const midX = (srcX + tgtX) / 2;
                const hasHorizontalSpace = Math.abs(srcX - midX) >= minHorizontalDist &&
                                           Math.abs(midX - tgtX) >= minHorizontalDist;
                if (hasHorizontalSpace && validForSource(midX) && validForTarget(midX) &&
                    !horizontalSegmentBlocked(srcX, midX, startY) &&
                    !verticalSegmentBlocked(startY, endY, midX) &&
                    !horizontalSegmentBlocked(midX, tgtX, endY)) {
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, midX),
                    });
                }

                // Route 2: Go around via left side (only valid for left-exiting sources)
                if (srcDir === 'left' && tgtDir === 'left' &&
                    !horizontalSegmentBlocked(srcX, routeLeftX, startY) &&
                    !verticalSegmentBlocked(startY, endY, routeLeftX) &&
                    !horizontalSegmentBlocked(routeLeftX, tgtX, endY)) {
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, routeLeftX),
                    });
                }

                // Route 3: Go around via right side (only valid for right-exiting sources)
                if (srcDir === 'right' && tgtDir === 'right' &&
                    !horizontalSegmentBlocked(srcX, routeRightX, startY) &&
                    !verticalSegmentBlocked(startY, endY, routeRightX) &&
                    !horizontalSegmentBlocked(routeRightX, tgtX, endY)) {
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, routeRightX),
                    });
                }

                // Route 4: Simple L-shaped path going directly toward target
                // Always add this option and let scoring penalize if it touches nodes
                const jogOutX = srcDir === 'right' ? srcX + 30 : srcX - 30;
                routeOptions.push({
                    points: [
                        { x: srcX, y: startY },
                        { x: jogOutX, y: startY },
                        { x: jogOutX, y: endY },
                        { x: tgtX, y: endY },
                    ],
                });

                // Route 5: Go wide around all nodes via the outer edges
                const wideX = srcDir === 'right' ? routeRightX : routeLeftX;
                routeOptions.push({
                    points: [
                        { x: srcX, y: startY },
                        { x: wideX, y: startY },
                        { x: wideX, y: endY },
                        { x: tgtX, y: endY },
                    ],
                });
            }

            // Score each route option considering existing routes and node overlaps
            let bestRoute = null;
            let bestScore = Infinity;

            for (const option of routeOptions) {
                const score = this.scorePath(option.points, routes, nodeBounds, excludeKeys);
                if (score < bestScore) {
                    bestScore = score;
                    bestRoute = option.points;
                }
            }

            // Fallback if no valid routes found - use routeRightX to go around
            if (!bestRoute) {
                bestRoute = this.buildPathPoints(
                    sBounds.right, startY,
                    tBounds.right, endY,
                    routeRightX
                );
            }

            routes.push({ edge, points: bestRoute });
        }

        return routes;
    },

    /**
     * Build path points for a horizontal-vertical-horizontal route
     * Always ensures horizontal segments at start and end for proper marker display
     */
    buildPathPoints(srcX, srcY, tgtX, tgtY, midX) {
        const points = [{ x: srcX, y: srcY }];

        // Always add the horizontal segment from source to midX
        // (even if small, this ensures markers have a direction)
        if (srcX !== midX) {
            points.push({ x: midX, y: srcY });
        }

        // Add vertical segment if Y positions differ
        if (Math.abs(srcY - tgtY) > 1) {
            points.push({ x: midX, y: tgtY });
        }

        // Always add the horizontal segment from midX to target
        if (midX !== tgtX) {
            points.push({ x: tgtX, y: tgtY });
        }

        // Ensure we have at least the end point
        const lastPoint = points[points.length - 1];
        if (lastPoint.x !== tgtX || lastPoint.y !== tgtY) {
            points.push({ x: tgtX, y: tgtY });
        }

        return points;
    },

    /**
     * Convert points to SVG path with rounded corners
     */
    pathToSvgRounded(points, radius = 8) {
        if (points.length < 2) return '';
        if (points.length === 2) {
            return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
        }

        let d = `M ${points[0].x} ${points[0].y}`;

        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            const dx1 = curr.x - prev.x;
            const dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x;
            const dy2 = next.y - curr.y;

            const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            const r = Math.min(radius, dist1 / 2, dist2 / 2);

            if (r > 1 && dist1 > 1 && dist2 > 1) {
                const startX = curr.x - (dx1 / dist1) * r;
                const startY = curr.y - (dy1 / dist1) * r;
                const endX = curr.x + (dx2 / dist2) * r;
                const endY = curr.y + (dy2 / dist2) * r;

                d += ` L ${startX} ${startY}`;
                d += ` Q ${curr.x} ${curr.y} ${endX} ${endY}`;
            } else {
                d += ` L ${curr.x} ${curr.y}`;
            }
        }

        const last = points[points.length - 1];
        d += ` L ${last.x} ${last.y}`;

        return d;
    },
};

window.Layout = Layout;
