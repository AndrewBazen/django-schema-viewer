/**
 * Graph layout and orthogonal edge routing for Django Schema Viewer
 * Uses a hub-and-spoke layout centered on the most connected node
 */

const Layout = {
    config: {
        rowWidth: 200,
        horizontalGap: 100,
        verticalGap: 50,
    },

    /**
     * Calculate layout centered on the most connected node
     */
    calculateHierarchicalLayout(schema, nodeHeights, nodeWidths) {
        // Use Map for O(1) node lookups and Set for connections
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
                    width: nodeWidths[key],
                    connections: new Set(),
                });
            }
        }

        // Build edges and connections
        for (const [key, node] of nodeMap) {
            for (const rel of node.model.relationships || []) {
                if (rel.direction !== 'forward') continue;
                const targetKey = `${rel.target_app}.${rel.target_model}`;
                if (nodeMap.has(targetKey)) {
                    // Use a string key for edge deduplication
                    const edgeKey = `${key}|${targetKey}|${rel.name}`;
                    if (!edges.has(edgeKey)) {
                        edges.add(edgeKey);
                    }
                    node.connections.add(targetKey);
                    if (targetKey !== key) {
                        nodeMap.get(targetKey).connections.add(key);
                    }
                }
            }
        }

        // Convert edge keys back to edge objects for rendering
        const edgeList = [...edges].map(edgeKey => {
            const [source, target, relName] = edgeKey.split('|');
            const sourceNode = nodeMap.get(source);
            const rel = sourceNode.model.relationships.find(r =>
                r.direction === 'forward' && r.name === relName &&
                `${r.target_app}.${r.target_model}` === target
            );
            return { source, target, rel };
        });

        // Find the hub node (most connections)
        let hubNode = null;
        let maxConnections = -1;
        for (const [key, node] of nodeMap) {
            if (node.connections.size > maxConnections) {
                maxConnections = node.connections.size;
                hubNode = node;
            }
        }

        // Categorize nodes by their relationship to the hub
        const referenced = new Set();  // Hub references these (hub has FK to them)
        const referencers = new Set(); // These reference the hub (they have FK to hub)

        for (const { source, target } of edgeList) {
            if (source === hubNode.key && target !== hubNode.key) {
                referenced.add(target);
            }
            if (target === hubNode.key && source !== hubNode.key) {
                referencers.add(source);
            }
        }

        // Remove nodes that are both referenced and referencers from referencers
        for (const key of referenced) {
            referencers.delete(key);
        }

        // Remaining nodes (not hub, not directly connected)
        const directlyConnected = new Set([...referenced, ...referencers]);
        const remaining = [...nodeMap.keys()].filter(k =>
            k !== hubNode.key && !directlyConnected.has(k)
        );

        // Calculate positions
        const positions = new Map();
        const { rowWidth, horizontalGap, verticalGap } = this.config;

        const referencedList = [...referenced];
        const referencersList = [...referencers];

        // Row 0: Nodes that the hub references (parent tables)
        let row0Width = referencedList.length * rowWidth + (referencedList.length - 1) * horizontalGap;
        let startX = 50;
        let currentY = 50;

        referencedList.forEach((key, idx) => {
            positions.set(key, {
                x: startX + idx * (nodeWidth + horizontalGap),
                y: currentY,
            });
        });

        // Calculate row 0 height
        const row0Height = referencedList.length > 0
            ? Math.max(...referencedList.map(k => nodeHeights[k] || 180))
            : 0;

        // Row 1: The hub node (centered under referenced nodes)
        currentY += row0Height > 0 ? row0Height + verticalGap : 0;

        // Center the hub
        const hubX = referencedList.length > 0
            ? startX + (row0Width - nodeWidth) / 2
            : startX + horizontalGap;

        positions.set(hubNode.key, {
            x: hubX,
            y: currentY,
        });

        const hubHeight = nodeHeights[hubNode.key] || 180;

        // Row 2: Nodes that reference the hub (child tables)
        currentY += hubHeight + verticalGap;

        // Split referencers to left and right of center for better distribution
        const leftReferencers = referencersList.slice(0, Math.ceil(referencersList.length / 2));
        const rightReferencers = referencersList.slice(Math.ceil(referencersList.length / 2));

        // Position left referencers
        leftReferencers.forEach((key, idx) => {
            positions.set(key, {
                x: hubX - (leftReferencers.length - idx) * (nodeWidth + horizontalGap),
                y: currentY,
            });
        });

        // Position right referencers
        rightReferencers.forEach((key, idx) => {
            positions.set(key, {
                x: hubX + (idx + 1) * (nodeWidth + horizontalGap),
                y: currentY,
            });
        });

        // Row 2 height
        const row2Height = referencersList.length > 0
            ? Math.max(...referencersList.map(k => nodeHeights[k] || 180))
            : 0;

        // Row 3: Remaining nodes
        if (remaining.length > 0) {
            currentY += row2Height > 0 ? row2Height + verticalGap : hubHeight + verticalGap;

            remaining.forEach((key, idx) => {
                positions.set(key, {
                    x: startX + idx * (nodeWidth + horizontalGap),
                    y: currentY,
                });
            });
        }

        // Normalize positions (shift everything so nothing is negative)
        let minX = Infinity;
        for (const pos of positions.values()) {
            minX = Math.min(minX, pos.x);
        }

        if (minX < 50) {
            const shiftX = 50 - minX;
            for (const pos of positions.values()) {
                pos.x += shiftX;
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
     * Calculate orthogonal edge routes
     * @param {Map} positions - Map of node keys to {x, y} positions
     * @param {Array} edges - Array of edge objects
     * @param {Object} nodeHeights - Object mapping node keys to heights
     * @param {Map} nodeMap - Map of node keys to node data
     */
    calculateEdgeRoutes(positions, edges, nodeHeights, nodeMap) {
        const routes = [];
        const { nodeWidth } = this.config;

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
            const sBounds = nodeBounds.get(edge.source);
            const tBounds = nodeBounds.get(edge.target);
            if (!sBounds || !tBounds) continue;

            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            if (!sourceNode || !targetNode) continue;

            // Get field Y offsets
            const sourceFieldY = sBounds.top + this.getFieldYOffset(sourceNode.model, edge.rel.name);
            const targetFieldY = tBounds.top + this.getPkYOffset(targetNode.model);

            const excludeKeys = new Set([edge.source, edge.target]);

            // Find all obstacles between source and target
            const obstacles = [];
            for (const [key, bounds] of nodeBounds) {
                if (excludeKeys.has(key)) continue;
                obstacles.push({ key, bounds });
            }

            const startY = sourceFieldY;
            const endY = targetFieldY;

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

            // Determine the natural side preference based on relative positions
            const sourceIsLeftOfTarget = sBounds.centerX < tBounds.centerX;
            const sourceIsAboveTarget = sBounds.centerY < tBounds.centerY;

            // Build routing options - prioritize natural directions
            const routeOptions = [];

            // Define side combinations with priority based on relative positions
            const sideCombos = [];

            if (sourceIsLeftOfTarget) {
                // Source is left of target: prefer source-right to target-left
                sideCombos.push({ srcX: sBounds.right, tgtX: tBounds.left, priority: 0 });
                sideCombos.push({ srcX: sBounds.right, tgtX: tBounds.right, priority: 1 });
                sideCombos.push({ srcX: sBounds.left, tgtX: tBounds.left, priority: 2 });
                sideCombos.push({ srcX: sBounds.left, tgtX: tBounds.right, priority: 3 });
            } else {
                // Source is right of target: prefer source-left to target-right
                sideCombos.push({ srcX: sBounds.left, tgtX: tBounds.right, priority: 0 });
                sideCombos.push({ srcX: sBounds.left, tgtX: tBounds.left, priority: 1 });
                sideCombos.push({ srcX: sBounds.right, tgtX: tBounds.right, priority: 2 });
                sideCombos.push({ srcX: sBounds.right, tgtX: tBounds.left, priority: 3 });
            }

            for (const { srcX, tgtX, priority } of sideCombos) {
                // Route 1: Direct path through midpoint
                const midX = (srcX + tgtX) / 2;
                if (!horizontalSegmentBlocked(srcX, midX, startY) &&
                    !verticalSegmentBlocked(startY, endY, midX) &&
                    !horizontalSegmentBlocked(midX, tgtX, endY)) {
                    const pathLength = Math.abs(srcX - midX) + Math.abs(startY - endY) + Math.abs(midX - tgtX);
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, midX),
                        length: pathLength + priority * 10, // Add priority penalty
                        srcX, tgtX,
                    });
                }

                // Route 2: Go around via left side
                if (!horizontalSegmentBlocked(srcX, routeLeftX, startY) &&
                    !verticalSegmentBlocked(startY, endY, routeLeftX) &&
                    !horizontalSegmentBlocked(routeLeftX, tgtX, endY)) {
                    const pathLength = Math.abs(srcX - routeLeftX) + Math.abs(startY - endY) + Math.abs(routeLeftX - tgtX);
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, routeLeftX),
                        length: pathLength + priority * 10,
                        srcX, tgtX,
                    });
                }

                // Route 3: Go around via right side
                if (!horizontalSegmentBlocked(srcX, routeRightX, startY) &&
                    !verticalSegmentBlocked(startY, endY, routeRightX) &&
                    !horizontalSegmentBlocked(routeRightX, tgtX, endY)) {
                    const pathLength = Math.abs(srcX - routeRightX) + Math.abs(startY - endY) + Math.abs(routeRightX - tgtX);
                    routeOptions.push({
                        points: this.buildPathPoints(srcX, startY, tgtX, endY, routeRightX),
                        length: pathLength + priority * 10,
                        srcX, tgtX,
                    });
                }

                // Route 4: Vertical-first routing (go up/down first, then horizontal)
                // This helps when nodes are on the same horizontal line
                const goAbove = Math.min(sBounds.top, tBounds.top) - 30;
                const goBelow = Math.max(sBounds.bottom, tBounds.bottom) + 30;

                for (const vertY of [goAbove, goBelow]) {
                    if (!verticalSegmentBlocked(startY, vertY, srcX) &&
                        !horizontalSegmentBlocked(srcX, tgtX, vertY) &&
                        !verticalSegmentBlocked(vertY, endY, tgtX)) {
                        const pathLength = Math.abs(startY - vertY) + Math.abs(srcX - tgtX) + Math.abs(vertY - endY);
                        routeOptions.push({
                            points: [
                                { x: srcX, y: startY },
                                { x: srcX, y: vertY },
                                { x: tgtX, y: vertY },
                                { x: tgtX, y: endY },
                            ],
                            length: pathLength + priority * 10 + 5, // Slight penalty for vertical-first
                            srcX, tgtX,
                        });
                    }
                }
            }

            // Pick the shortest route
            routeOptions.sort((a, b) => a.length - b.length);

            let points;
            if (routeOptions.length > 0) {
                points = routeOptions[0].points;
            } else {
                // Fallback: go wide right
                points = this.buildPathPoints(sBounds.right, startY, tBounds.right, endY, routeRightX);
            }

            routes.push({ edge, points });
        }

        return routes;
    },

    /**
     * Build path points for a horizontal-vertical-horizontal route
     */
    buildPathPoints(srcX, srcY, tgtX, tgtY, midX) {
        // Remove redundant points where coordinates match
        const points = [{ x: srcX, y: srcY }];

        if (Math.abs(srcX - midX) > 1) {
            points.push({ x: midX, y: srcY });
        }

        if (Math.abs(srcY - tgtY) > 1) {
            points.push({ x: midX, y: tgtY });
        }

        if (Math.abs(midX - tgtX) > 1) {
            points.push({ x: tgtX, y: tgtY });
        } else if (points[points.length - 1].x !== tgtX || points[points.length - 1].y !== tgtY) {
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
