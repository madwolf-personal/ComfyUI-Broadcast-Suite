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

// --- VALIDATE GROUPS (Must have at least ONE Helper Node) ---
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

// --- READ VALUE FROM AN UPSTREAM NODE CONNECTED TO A WIDGET-INPUT ---
function getConnectedInputValue(node, widget) {
    if (!node || !widget || !node.inputs) return undefined;
    const input = node.inputs.find(i => i.name === widget.name || i.widget?.name === widget.name);
    if (!input || input.link == null) return undefined;

    const graph = node.graph || app.graph;
    const link = graph?.links?.[input.link];
    if (!link) return undefined;

    const originNode = graph.getNodeById(link.origin_id);
    if (!originNode || !originNode.widgets) return undefined;

    // Try common widget names first, then fall back to the first widget
    const candidateNames = ["text", "value", "string", widget.name];
    for (const name of candidateNames) {
        const w = originNode.widgets.find(w => w.name === name);
        if (w) return w.value;
    }
    return originNode.widgets[0]?.value;
}

// --- SAFELY PUSH VALUES TO WIDGETS ---
function setWidgetValue(node, widget, value) {
    if (!node || !widget) return;
    if (widget.value !== value) {
        widget.value = value;
        const wIdx = node.widgets.indexOf(widget);
        if (node.widgets_values && wIdx > -1) {
            node.widgets_values[wIdx] = value;
        }
        if (widget.inputEl) widget.inputEl.value = value;
        if (widget.element) widget.element.value = value;
    }
}

// --- DYNAMICALLY ENABLE/DISABLE WIDGETS ---
function setWidgetEnabled(widget, isEnabled) {
    if (!widget) return;
    widget.disabled = !isEnabled;
    if (widget.inputEl) {
        widget.inputEl.disabled = !isEnabled;
        widget.inputEl.style.opacity = isEnabled ? "1" : "0.4"; 
        widget.inputEl.style.cursor = isEnabled ? "text" : "not-allowed";
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

    // --- PUSH A PROMPT VALUE TO THE ACTIVE GROUP'S RECEIVER NODE ---
    pushPromptToReceiver(node, val) {
        const combo = node.widgets.find(w => w.name === "target_group");
        if (!combo) return;
        const targetGroup = combo.value;
        const groups = getValidGroups();
        const activeGroup = groups.find(g => (g.title || "").trim() === targetGroup);
        if (activeGroup) {
            const promptReceiver = getNodesInGroup(activeGroup).find(n => n.type === "BroadcastedPrompt");
            if (promptReceiver) {
                const rWidget = promptReceiver.widgets.find(w => w.name === "text");
                setWidgetValue(promptReceiver, rWidget, val);
            }
        }
    },

    setupNode(node) {
        if (!node || !node.widgets) return;
        
        const combo = node.widgets.find(w => w.name === "target_group");
        const promptBox = node.widgets.find(w => w.name === "master_prompt");
        const seedBox = node.widgets.find(w => w.name === "current_seed");

        if (promptBox && !promptBox._patched) {
            const origCb = promptBox.callback;
            promptBox.callback = function(val) {
                if (promptBox.disabled) return; 
                if (origCb) origCb.apply(this, [val]);
                controllerManager.pushPromptToReceiver(node, val);
            };
            promptBox._patched = true;
        }

        if (seedBox && !seedBox._patched) {
            const origCb = seedBox.callback;
            seedBox.callback = function(val) {
                if (seedBox.disabled) return; 
                if (origCb) origCb.apply(this, [val]);
                
                const targetGroup = combo.value;
                const groups = getValidGroups();
                const activeGroup = groups.find(g => (g.title || "").trim() === targetGroup);
                if (activeGroup) {
                    const seedReceivers = getNodesInGroup(activeGroup).filter(n => n.type === "BroadcastedSeed");
                    seedReceivers.forEach(receiver => {
                        const rWidget = receiver.widgets?.find(w => w.name === "int_value");
                        setWidgetValue(receiver, rWidget, val);
                    });
                }
            };
            seedBox._patched = true;
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
        let seedBox = node.widgets.find(w => w.name === "current_seed");

        if (!combo || !lock || !promptBox) return;

        const validGroups = getValidGroups();
        const groupTitles = validGroups.map(g => (g.title || "").trim() || "Group");
        if (groupTitles.length === 0) groupTitles.push("No Valid Target Groups");

        combo.options = combo.options || {};
        combo.options.values = groupTitles;
        if (!groupTitles.includes(combo.value)) combo.value = groupTitles[0];

        const currentTarget = combo.value;
        const activeGroupObj = validGroups.find(g => (g.title || "").trim() === currentTarget);

        let hasPromptNode = false;
        let hasSeedNode = false;

        // SYNC VALUES & DETERMINE WIDGET AVAILABILITY
        if (activeGroupObj) {
            const groupNodes = getNodesInGroup(activeGroupObj);
            
            const promptReceiver = groupNodes.find(n => n.type === "BroadcastedPrompt");
            if (promptReceiver) {
                hasPromptNode = true;
                const rWidget = promptReceiver.widgets?.find(w => w.name === "text");
                if (rWidget) setWidgetValue(node, promptBox, rWidget.value || "");
            }

            const seedReceiver = groupNodes.find(n => n.type === "BroadcastedSeed");
            if (seedReceiver) {
                hasSeedNode = true;
                const rWidget = seedReceiver.widgets?.find(w => w.name === "int_value");
                if (rWidget && rWidget.value !== undefined) {
                    setWidgetValue(node, seedBox, rWidget.value);
                }
            }
        }

        // CLEAR VALUES IF NO RECEIVER EXISTS
        if (!hasPromptNode) setWidgetValue(node, promptBox, "");
        if (!hasSeedNode && seedBox) setWidgetValue(node, seedBox, 0);

        // ENABLE OR DISABLE WIDGETS DYNAMICALLY
        setWidgetEnabled(promptBox, hasPromptNode);
        setWidgetEnabled(seedBox, hasSeedNode);
        setWidgetEnabled(lock, hasSeedNode);

        // MUTING LOGIC
        const activeIdx = validGroups.findIndex(g => (g.title || "").trim() === currentTarget);
        for (let i = 0; i < validGroups.length; i++) {
            const g = validGroups[i];
            if (!g) continue;
            getNodesInGroup(g).forEach(n => { 
                if (n) n.mode = (activeIdx === -1 || i <= activeIdx) ? 0 : 4; 
            });
        }
    },

    // --- INJECT OR SYNC SEEDS ON QUEUE ---
    injectSeedsBeforeGeneration() {
        this.nodes.forEach(controllerNode => {
            if (!controllerNode.widgets) return;
            const combo = controllerNode.widgets.find(w => w.name === "target_group");
            const lock = controllerNode.widgets.find(w => w.name === "lock_seed");
            const seedBox = controllerNode.widgets.find(w => w.name === "current_seed");
            
            // If the seed section is disabled or locked, do nothing
            if (!combo || !lock || lock.disabled || lock.value === true) return;

            const validGroups = getValidGroups();
            const activeGroup = validGroups.find(g => (g.title || "").trim() === combo.value);
            
            if (activeGroup) {
                const seedReceivers = getNodesInGroup(activeGroup).filter(n => n.type === "BroadcastedSeed");
                
                let seedToUse = seedBox ? seedBox.value : 0;

                // Generate new random seed and show it in our UI box!
                seedToUse = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
                if (seedBox) {
                    setWidgetValue(controllerNode, seedBox, seedToUse);
                }

                // Push whatever seed we settled on to the target receiver nodes
                seedReceivers.forEach(receiver => {
                    const widget = receiver.widgets?.find(w => w.name === "int_value");
                    if (widget) {
                        setWidgetValue(receiver, widget, seedToUse);
                    }
                });
            }
        });
    }
};

// Polling for UI updates
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

        // --- CHECK FOR AN UPSTREAM-CONNECTED master_prompt VALUE ---
        const promptBox = node.widgets?.find(w => w.name === "master_prompt");
        if (promptBox && !promptBox.disabled) {
            const upstreamVal = getConnectedInputValue(node, promptBox);
            if (upstreamVal !== undefined && upstreamVal !== node._lastUpstreamPromptValue) {
                node._lastUpstreamPromptValue = upstreamVal;
                setWidgetValue(node, promptBox, upstreamVal);
                controllerManager.pushPromptToReceiver(node, upstreamVal);
            }
        }
    });
}, 600);

app.registerExtension({
    name: "utility.group.controller",
    
    setup() {
        const origQueuePrompt = app.queuePrompt;
        app.queuePrompt = async function() {
            controllerManager.injectSeedsBeforeGeneration();
            return origQueuePrompt.apply(this, arguments);
        };
    },

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name === "BroadcastTargetGroup") {
            const origCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                if (origCreated) origCreated.apply(this, arguments);
                
                // --- NEW: Remove connection pins for UI-only widgets ---
                const pinsToRemove = ["target_group", "lock_seed", "current_seed"];
                pinsToRemove.forEach(pinName => {
                    const idx = this.findInputSlot(pinName);
                    if (idx > -1) this.removeInput(idx);
                });

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