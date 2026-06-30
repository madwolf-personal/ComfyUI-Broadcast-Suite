import { app } from "../../scripts/app.js";

// --- FIND ALL GROUPS ---
function getAllGroupsInGraph(graph) {
    let groups = [];
    if (!graph) return groups;
    if (graph._groups) {
        graph._groups.forEach(g => {
            g._parentGraph = graph;
            groups.push(g);
        });
    }
    if (graph._nodes) {
        for (const node of graph._nodes) {
            if (node.subgraph) groups.push(...getAllGroupsInGraph(node.subgraph));
        }
    }
    return groups;
}

// --- FIND NODES INSIDE A SPECIFIC GROUP ---
function getNodesInGroup(group) {
    const graph = group._parentGraph || app.graph;
    if (!graph || !graph._nodes) return [];
    const [gX, gY] = group.pos;
    const [gW, gH] = group.size;
    return graph._nodes.filter(n => {
        if (!n.pos) return false;
        const [nX, nY] = n.pos;
        const nW = n.size?.[0] || 100;
        const nH = n.size?.[1] || 50;
        return (nX < gX + gW && nX + nW > gX && nY < gY + gH && nY + nH > gY);
    });
}

// --- VALIDATE GROUPS (Must have at least ONE of the Helper Nodes) ---
function getValidGroups() {
    const rootGraph = app.graph?.rootGraph || app.graph;
    const allGroups = getAllGroupsInGraph(rootGraph);
    const validGroups = allGroups.filter(g => {
        const nodes = getNodesInGroup(g);
        return nodes.some(n => n.type === "BroadcastedPrompt" || n.type === "BroadcastedSeed");
    });
    validGroups.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return validGroups;
}

// --- SAFELY PUSH TEXT TO HELPER NODE ---
function setWidgetText(node, widget, text) {
    if (!node || !widget) return;
    const valStr = String(text || "");
    if (widget.value !== valStr) {
        widget.value = valStr;
        const wIdx = node.widgets.indexOf(widget);
        if (node.widgets_values && wIdx > -1) {
            node.widgets_values[wIdx] = valStr;
        }
        if (widget.inputEl) widget.inputEl.value = valStr;
        if (widget.element) widget.element.value = valStr;
    }
}

const controllerManager = {
    nodes: new Set(),
    
    registerNode(node) {
        if (!node) return;
        this.nodes.add(node);
        setTimeout(() => {
            this.setupNode(node);
            this.rebuildUI(node);
        }, 100);
    },

    unregisterNode(node) {
        if (node) this.nodes.delete(node);
    },

    setupNode(node) {
        if (!node || !node.widgets) return;
        
        const combo = node.widgets.find(w => w.name === "target_group");
        const promptBox = node.widgets.find(w => w.name === "master_prompt");

        if (promptBox && !promptBox._patched) {
            const origCb = promptBox.callback;
            promptBox.callback = function(val) {
                if (origCb) origCb.apply(this, [val]);
                
                const targetGroup = combo.value;
                const groups = getValidGroups();
                const activeGroup = groups.find(g => (g.title || "").trim() === targetGroup);
                
                if (activeGroup) {
                    const promptReceiver = getNodesInGroup(activeGroup).find(n => n.type === "BroadcastedPrompt");
                    if (promptReceiver) {
                        const rWidget = promptReceiver.widgets.find(w => w.name === "text");
                        setWidgetText(promptReceiver, rWidget, val);
                    }
                }
            };
            promptBox._patched = true;
        }
        
        if (combo && !combo._patched) {
            const origCb = combo.callback;
            combo.callback = function(val) {
                if (origCb) origCb.apply(this, [val]);
                controllerManager.rebuildUI(node);
            };
            combo._patched = true;
        }
    },

    rebuildUI(node) {
        if (!node || !app.graph || !node.widgets) return;

        let combo = node.widgets.find(w => w.name === "target_group");
        let lock = node.widgets.find(w => w.name === "lock_seed");
        let promptBox = node.widgets.find(w => w.name === "master_prompt");

        if (!combo || !lock || !promptBox) return;

        const validGroups = getValidGroups();
        const groupTitles = validGroups.map(g => (g.title || "").trim() || "Group");
        if (groupTitles.length === 0) groupTitles.push("No Valid Target Groups");

        combo.options = combo.options || {};
        combo.options.values = groupTitles;
        if (!groupTitles.includes(combo.value)) combo.value = groupTitles[0];

        const currentTarget = combo.value;

        // SEEDS
        validGroups.forEach(g => {
            const isTarget = (g.title || "").trim() === currentTarget;
            const seedReceivers = getNodesInGroup(g).filter(n => n.type === "BroadcastedSeed");
            
            seedReceivers.forEach(sr => {
                const ctrl = sr.widgets?.find(w => w.name && w.name.includes("control") && w.name.includes("generate"));
                if (ctrl) {
                    ctrl.value = isTarget ? (lock.value ? "fixed" : "randomize") : "fixed";
                }
            });
        });

        // TEXT
        const activeGroupObj = validGroups.find(g => (g.title || "").trim() === currentTarget);
        if (activeGroupObj) {
            const promptReceiver = getNodesInGroup(activeGroupObj).find(n => n.type === "BroadcastedPrompt");
            if (promptReceiver) {
                const rWidget = promptReceiver.widgets?.find(w => w.name === "text");
                if (rWidget) {
                    setWidgetText(node, promptBox, rWidget.value || "");
                }
            } else {
                setWidgetText(node, promptBox, "");
            }
        }

        // MUTING
        const activeIdx = validGroups.findIndex(g => (g.title || "").trim() === currentTarget);
        for (let i = 0; i < validGroups.length; i++) {
            const g = validGroups[i];
            if (!g) continue;
            getNodesInGroup(g).forEach(n => { 
                if (n) n.mode = (activeIdx === -1 || i <= activeIdx) ? 0 : 4; 
            });
        }
    }
};

setInterval(() => {
    if (!app.graph || controllerManager.nodes.size === 0) return;
    
    controllerManager.nodes.forEach(node => {
        let hash = "";
        const validGroups = getValidGroups();
        hash += validGroups.map(g => g.title || "").join("|");
        
        const combo = node.widgets?.find(w => w.name === "target_group");
        const lock = node.widgets?.find(w => w.name === "lock_seed");
        if (!combo || !lock) return;

        hash += combo.value + "|" + lock.value;
        
        if (node._lastHash !== hash) {
            node._lastHash = hash;
            controllerManager.rebuildUI(node);
        }
    });
}, 600);

app.registerExtension({
    name: "utility.group.controller",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === "BroadcastTargetGroup") {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (origCreated) origCreated.apply(this, arguments);
                controllerManager.registerNode(this);
            };
            const origRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function () {
                if (origRemoved) origRemoved.apply(this, arguments);
                controllerManager.unregisterNode(this);
            };
        }
    }
});