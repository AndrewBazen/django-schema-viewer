/**
 * Schema Viewer Canvas - Main application logic
 */

const SchemaViewer = {
    // State
    schema: null,
    selectedModel: null,
    visibleNodes: null, // null = show all, Set = show only these
    transform: { x: 0, y: 0, scale: 1 },
    nodePositions: new Map(),
    nodeHeights: {},
    layoutData: null,
    edgeRoutes: [],

    // Drag state
    isDragging: false,
    dragTarget: null,
    dragOffset: { x: 0, y: 0 },

    // Pan state
    isPanning: false,
    panStart: { x: 0, y: 0 },

    // DOM elements (set during init)
    elements: {},

    /**
     * Initialize the schema viewer
     */
    init() {
        // Cache DOM elements
        this.elements = {
            modelList: document.getElementById('model-list'),
            canvas: document.getElementById('canvas'),
            detailPanel: document.getElementById('detail-panel'),
            detailTitle: document.getElementById('detail-title'),
            detailContent: document.getElementById('detail-content'),
            searchInput: document.getElementById('search'),
            showDjangoCheckbox: document.getElementById('show-django'),
        };

        this.bindEvents();
        this.fetchSchema();
    },

    /**
     * Bind all event listeners
     */
    bindEvents() {
        const { canvas, searchInput, showDjangoCheckbox } = this.elements;

        // Toolbar buttons
        document.getElementById('close-detail').addEventListener('click', () => this.closeDetail());
        document.getElementById('zoom-in').addEventListener('click', () => this.zoom(1.2));
        document.getElementById('zoom-out').addEventListener('click', () => this.zoom(1 / 1.2));
        document.getElementById('fit-view').addEventListener('click', () => this.fitView());
        document.getElementById('re-layout').addEventListener('click', () => this.recalculateLayout());

        // Search and filter
        searchInput.addEventListener('input', () => this.renderModelList());
        showDjangoCheckbox.addEventListener('change', () => this.fetchSchema());

        // Canvas interactions
        canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        canvas.addEventListener('wheel', (e) => this.onCanvasWheel(e));

        // Global mouse events
        window.addEventListener('mousemove', (e) => this.onMouseMove(e));
        window.addEventListener('mouseup', () => this.onMouseUp());
    },

    /**
     * Fetch schema data from API
     */
    async fetchSchema() {
        const excludeDjango = !this.elements.showDjangoCheckbox.checked;
        const response = await fetch(`api/schema/?exclude_django=${excludeDjango}`);
        this.schema = await response.json();

        this.renderModelList();
        this.calculateLayout();
        this.visibleNodes = null; // Show all nodes by default
        this.fitView();
    },

    /**
     * Calculate layout positions
     */
    calculateLayout() {
        this.nodeHeights = Utils.calculateNodeHeights(this.schema);
        this.layoutData = Layout.calculateHierarchicalLayout(this.schema, this.nodeHeights);
        this.nodePositions = this.layoutData.positions;
        this.edgeRoutes = Layout.calculateEdgeRoutes(
            this.nodePositions,
            this.layoutData.edges,
            this.nodeHeights,
            this.layoutData.nodeMap
        );
    },

    /**
     * Render the model list in sidebar
     */
    renderModelList() {
        const searchTerm = this.elements.searchInput.value.toLowerCase();
        let html = '';

        for (const [appLabel, appData] of Object.entries(this.schema.apps)) {
            const models = Object.entries(appData.models).filter(([name]) =>
                name.toLowerCase().includes(searchTerm)
            );

            if (models.length === 0) continue;

            html += `
                <div class="app-group">
                    <div class="app-header" data-app="${appLabel}">
                        <span class="arrow">▼</span>
                        ${appData.verbose_name}
                    </div>
                    <div class="app-models">
                        ${models.map(([modelName, model]) => `
                            <div class="model-item" data-app="${appLabel}" data-model="${modelName}">
                                ${model.verbose_name}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        this.elements.modelList.innerHTML = html || '<div class="loading">No models found</div>';

        // Bind sidebar events
        this.elements.modelList.querySelectorAll('.app-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                header.nextElementSibling.style.display =
                    header.classList.contains('collapsed') ? 'none' : 'block';
            });
        });

        this.elements.modelList.querySelectorAll('.model-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectModel(item.dataset.app, item.dataset.model);
            });
        });
    },

    /**
     * Render the canvas with nodes and edges
     */
    renderCanvas() {
        const edgesHtml = this.renderEdges();
        const nodesHtml = this.renderNodes();

        this.elements.canvas.innerHTML = `
            ${Markers.getDefinitions()}
            <g transform="translate(${this.transform.x}, ${this.transform.y}) scale(${this.transform.scale})">
                ${edgesHtml}
                ${nodesHtml}
            </g>
        `;

        this.bindNodeEvents();
    },

    /**
     * Check if a node should be visible
     */
    isNodeVisible(key) {
        return this.visibleNodes === null || this.visibleNodes.has(key);
    },

    // Relationship colors
    relationshipColors: {
        foreign_key: '#3b82f6',  // blue
        one_to_one: '#8b5cf6',   // purple
        many_to_many: '#10b981', // green
    },

    /**
     * Get stroke color for a relationship type
     */
    getRelationshipColor(relType) {
        return this.relationshipColors[relType] || this.relationshipColors.foreign_key;
    },

    /**
     * Render edge paths
     */
    renderEdges() {
        let html = '';

        // Regular edges - only show if both nodes are visible
        for (const route of this.edgeRoutes) {
            const { edge, points } = route;
            if (!this.isNodeVisible(edge.source) || !this.isNodeVisible(edge.target)) {
                continue;
            }

            const rel = edge.rel;
            const relClass = rel.type.replace('_', '-');
            const pathD = Layout.pathToSvgRounded(points);
            const markers = Markers.getMarkersForPath(points, rel.type);
            const strokeColor = this.getRelationshipColor(rel.type);
            const dashStyle = rel.type === 'many_to_many' ? 'stroke-dasharray: 5,5;' : '';
            html += `
                <path class="relationship-line ${relClass}"
                      d="${pathD}"
                      style="stroke: ${strokeColor}; ${dashStyle}"
                      marker-start="${markers.start}"
                      marker-end="${markers.end}"
                      data-source="${edge.source}"
                      data-target="${edge.target}"
                      data-rel-name="${rel.name}"
                      data-rel-type="${rel.type}">
                    <title>${rel.name}: ${edge.source} → ${edge.target}</title>
                </path>
            `;
        }

        // Self-referential edges
        html += this.renderSelfReferentialEdges();

        return html;
    },

    /**
     * Render self-referential relationship edges
     */
    renderSelfReferentialEdges() {
        let html = '';

        for (const [appLabel, appData] of Object.entries(this.schema.apps)) {
            for (const [modelName, model] of Object.entries(appData.models)) {
                const sourceKey = `${appLabel}.${modelName}`;
                if (!this.isNodeVisible(sourceKey)) continue;

                const sourcePos = this.nodePositions.get(sourceKey);
                if (!sourcePos) continue;

                for (const rel of model.relationships || []) {
                    if (rel.direction !== 'forward') continue;
                    const targetKey = `${rel.target_app}.${rel.target_model}`;
                    if (targetKey !== sourceKey) continue;

                    const relClass = rel.type.replace('_', '-');
                    const height = this.nodeHeights[sourceKey] || 180;
                    const loopSize = 40;
                    const startX = sourcePos.x + Layout.config.nodeWidth;
                    const startY = sourcePos.y + height / 3;
                    const endY = sourcePos.y + height * 2 / 3;

                    const selfPoints = [
                        { x: startX, y: startY },
                        { x: startX + loopSize, y: startY },
                        { x: startX + loopSize, y: endY },
                        { x: startX, y: endY },
                    ];
                    const markers = Markers.getMarkersForPath(selfPoints, rel.type);
                    const pathD = Layout.pathToSvgRounded(selfPoints);
                    const strokeColor = this.getRelationshipColor(rel.type);
                    const dashStyle = rel.type === 'many_to_many' ? 'stroke-dasharray: 5,5;' : '';

                    html += `
                        <path class="relationship-line ${relClass}"
                              d="${pathD}"
                              style="stroke: ${strokeColor}; ${dashStyle}"
                              marker-start="${markers.start}"
                              marker-end="${markers.end}"
                              data-source="${sourceKey}"
                              data-target="${targetKey}"
                              data-rel-name="${rel.name}"
                              data-rel-type="${rel.type}">
                            <title>${rel.name}: ${sourceKey} → ${targetKey} (self)</title>
                        </path>
                    `;
                }
            }
        }

        return html;
    },

    /**
     * Render node elements
     */
    renderNodes() {
        let html = '';

        for (const [appLabel, appData] of Object.entries(this.schema.apps)) {
            for (const [modelName, model] of Object.entries(appData.models)) {
                const key = `${appLabel}.${modelName}`;
                if (!this.isNodeVisible(key)) continue;

                const pos = this.nodePositions.get(key);
                if (!pos) continue;

                const isSelected = this.selectedModel === key;
                const height = this.nodeHeights[key] || 180;
                const { html: fieldsHtml, hasMore, moreCount } = Utils.generateFieldsHtml(
                    model.fields,
                    model.relationships
                );

                html += `
                    <foreignObject x="${pos.x}" y="${pos.y}" width="${Layout.config.nodeWidth}" height="${height}"
                                   class="node-wrapper" data-key="${key}">
                        <div xmlns="http://www.w3.org/1999/xhtml"
                             class="model-node ${isSelected ? 'selected' : ''}"
                             data-app="${appLabel}"
                             data-model="${modelName}">
                            <div class="model-node-header">
                                ${model.verbose_name}
                                <div class="model-node-app">${appData.verbose_name}</div>
                            </div>
                            <div class="model-node-fields">
                                ${fieldsHtml}
                                ${hasMore ? `<div style="color: #64748b; padding-top: 4px;">+${moreCount} more fields</div>` : ''}
                            </div>
                        </div>
                    </foreignObject>
                `;
            }
        }

        return html;
    },

    /**
     * Bind events to node elements
     */
    bindNodeEvents() {
        this.elements.canvas.querySelectorAll('.model-node').forEach(node => {
            node.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectModel(node.dataset.app, node.dataset.model);
            });

            node.addEventListener('mousedown', (e) => {
                this.isDragging = true;
                this.dragTarget = `${node.dataset.app}.${node.dataset.model}`;
                const pos = this.nodePositions.get(this.dragTarget);
                this.dragOffset = {
                    x: (e.clientX - this.transform.x) / this.transform.scale - pos.x,
                    y: (e.clientY - this.transform.y) / this.transform.scale - pos.y
                };
            });
        });
    },

    /**
     * Select a model and show details
     */
    async selectModel(appLabel, modelName) {
        const key = `${appLabel}.${modelName}`;
        this.selectedModel = key;

        // Update sidebar selection
        this.elements.modelList.querySelectorAll('.model-item').forEach(item => {
            item.classList.toggle('selected',
                item.dataset.app === appLabel && item.dataset.model === modelName);
        });

        // Filter to show only this model and its connections
        this.visibleNodes = new Set([key]);
        const node = this.layoutData.nodeMap.get(key);
        if (node) {
            for (const connectedKey of node.connections) {
                this.visibleNodes.add(connectedKey);
            }
        }

        // Fetch and show details
        const response = await fetch(`api/model/${appLabel}/${modelName}/`);
        const model = await response.json();

        this.elements.detailTitle.textContent = model.verbose_name;
        this.elements.detailContent.innerHTML = Utils.generateDetailHtml(model);
        this.elements.detailPanel.classList.add('visible');

        // Fit view to visible nodes
        this.fitView();
    },

    /**
     * Close the detail panel and show all nodes
     */
    closeDetail() {
        this.elements.detailPanel.classList.remove('visible');
        this.selectedModel = null;
        this.visibleNodes = null; // Show all nodes
        this.fitView();
    },

    /**
     * Zoom the canvas
     */
    zoom(factor) {
        this.transform.scale = Math.max(0.3, Math.min(3, this.transform.scale * factor));
        this.renderCanvas();
    },

    /**
     * Fit view to show all visible nodes
     */
    fitView() {
        const canvas = this.elements.canvas;
        const canvasRect = canvas.getBoundingClientRect();
        const padding = 50;

        // Calculate bounding box of visible nodes
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        let hasVisibleNodes = false;

        for (const [key, pos] of this.nodePositions) {
            if (!this.isNodeVisible(key)) continue;
            hasVisibleNodes = true;

            const height = this.nodeHeights[key] || 180;
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + Layout.config.nodeWidth);
            maxY = Math.max(maxY, pos.y + height);
        }

        if (!hasVisibleNodes) {
            this.transform = { x: 0, y: 0, scale: 1 };
            this.renderCanvas();
            return;
        }

        // Calculate content dimensions
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // Available space (account for detail panel if visible)
        const detailPanelWidth = this.elements.detailPanel.classList.contains('visible') ? 350 : 0;
        const availableWidth = canvasRect.width - detailPanelWidth - padding * 2;
        const availableHeight = canvasRect.height - padding * 2;

        // Calculate scale to fit content
        const scaleX = availableWidth / contentWidth;
        const scaleY = availableHeight / contentHeight;
        const scale = Math.min(scaleX, scaleY, 1.5); // Cap at 1.5x zoom

        // Calculate translation to center content
        const scaledWidth = contentWidth * scale;
        const scaledHeight = contentHeight * scale;
        const x = padding + (availableWidth - scaledWidth) / 2 - minX * scale;
        const y = padding + (availableHeight - scaledHeight) / 2 - minY * scale;

        this.transform = { x, y, scale };
        this.renderCanvas();
    },

    /**
     * Recalculate and re-render layout
     */
    recalculateLayout() {
        this.calculateLayout();
        this.fitView();
    },

    /**
     * Handle canvas mousedown for panning
     */
    onCanvasMouseDown(e) {
        const target = e.target;
        if (target === this.elements.canvas ||
            target.tagName === 'svg' ||
            target.tagName === 'g') {
            this.isPanning = true;
            this.panStart = {
                x: e.clientX - this.transform.x,
                y: e.clientY - this.transform.y
            };
        }
    },

    /**
     * Handle mouse wheel for zooming
     */
    onCanvasWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoom(delta);
    },

    /**
     * Handle global mouse move
     */
    onMouseMove(e) {
        if (this.isPanning) {
            this.transform.x = e.clientX - this.panStart.x;
            this.transform.y = e.clientY - this.panStart.y;
            this.renderCanvas();
        } else if (this.isDragging && this.dragTarget) {
            this.nodePositions.set(this.dragTarget, {
                x: (e.clientX - this.transform.x) / this.transform.scale - this.dragOffset.x,
                y: (e.clientY - this.transform.y) / this.transform.scale - this.dragOffset.y
            });

            // Recalculate edge routes
            this.edgeRoutes = Layout.calculateEdgeRoutes(
                this.nodePositions,
                this.layoutData.edges,
                this.nodeHeights,
                this.layoutData.nodeMap
            );
            this.renderCanvas();
        }
    },

    /**
     * Handle global mouse up
     */
    onMouseUp() {
        this.isPanning = false;
        this.isDragging = false;
        this.dragTarget = null;
    },
};

window.SchemaViewer = SchemaViewer;
