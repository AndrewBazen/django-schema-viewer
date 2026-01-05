/**
 * Utility functions for Django Schema Viewer
 */

const Utils = {
    /**
     * Calculate node heights based on field count
     * @param {Object} schema - The schema data
     * @param {number} maxFields - Maximum fields to display (default 5)
     * @returns {Object} Map of node keys to heights
     */
    calculateNodeHeights(schema, maxFields = 5) {
        const heights = {};
        const headerHeight = 50;
        const paddingHeight = 16;
        const fieldHeight = 28;
        const moreFieldsHeight = 24;

        for (const [appLabel, appData] of Object.entries(schema.apps)) {
            for (const [modelName, model] of Object.entries(appData.models)) {
                const key = `${appLabel}.${modelName}`;
                const fields = (model.fields || []).slice(0, maxFields);
                const hasMore = (model.fields?.length || 0) > maxFields;

                heights[key] = headerHeight + paddingHeight +
                    (fields.length * fieldHeight) +
                    (hasMore ? moreFieldsHeight : 0);
            }
        }

        return heights;
    },

    /**
     * Generate HTML for model fields
     * @param {Array} fields - Array of field objects
     * @param {Array} relationships - Array of relationship objects
     * @param {number} maxFields - Maximum fields to show
     * @returns {Object} { html: string, hasMore: boolean, moreCount: number }
     */
    generateFieldsHtml(fields, relationships, maxFields = 5) {
        const visibleFields = (fields || []).slice(0, maxFields);
        const hasMore = (fields?.length || 0) > maxFields;
        const moreCount = (fields?.length || 0) - maxFields;

        const html = visibleFields.map(f => {
            const isPk = f.primary_key;
            const isFk = relationships?.some(r =>
                r.direction === 'forward' && r.name === f.name.replace('_id', '')
            );
            const fieldClass = isPk ? 'pk' : (isFk ? 'fk' : '');
            const icon = isPk ? '🔑 ' : (isFk ? '🔗 ' : '');

            return `
                <div class="model-node-field ${fieldClass}">
                    <span>${icon}${f.name}</span>
                    <span class="model-node-field-type">${f.type}</span>
                </div>
            `;
        }).join('');

        return { html, hasMore, moreCount };
    },

    /**
     * Generate HTML for model detail panel
     * @param {Object} model - The model data
     * @returns {string} HTML string
     */
    generateDetailHtml(model) {
        let html = `
            <div class="detail-section">
                <h3>Info</h3>
                <div class="field-item">
                    <div class="field-name">Database Table</div>
                    <div class="field-type">${model.db_table}</div>
                </div>
                ${model.proxy ? '<div class="badge">Proxy Model</div>' : ''}
                ${model.abstract ? '<div class="badge">Abstract</div>' : ''}
            </div>

            <div class="detail-section">
                <h3>Fields (${model.fields?.length || 0})</h3>
                ${(model.fields || []).map(f => `
                    <div class="field-item">
                        <div class="field-name">${f.name}</div>
                        <div class="field-type">${f.type}${f.max_length ? `(${f.max_length})` : ''}</div>
                        <div class="field-badges">
                            ${f.primary_key ? '<span class="badge primary">PK</span>' : ''}
                            ${f.unique ? '<span class="badge unique">Unique</span>' : ''}
                            ${f.null ? '<span class="badge nullable">Nullable</span>' : ''}
                            ${f.db_index ? '<span class="badge indexed">Indexed</span>' : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        if (model.relationships?.length) {
            html += `
                <div class="detail-section">
                    <h3>Relationships (${model.relationships.length})</h3>
                    ${model.relationships.map(r => `
                        <div class="field-item">
                            <div class="field-name">${r.name}</div>
                            <div class="field-type">${r.type} → ${r.target_app}.${r.target_model}</div>
                            <div class="field-badges">
                                <span class="badge">${r.direction}</span>
                                ${r.on_delete ? `<span class="badge">${r.on_delete}</span>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        return html;
    },
};

window.Utils = Utils;
