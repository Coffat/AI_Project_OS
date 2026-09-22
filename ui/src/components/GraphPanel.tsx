import React, { useState, useMemo } from 'react';
import { UIGraphPanelState, UIGraphNode } from '../api/client.js';

interface GraphPanelProps {
  graphPanel: UIGraphPanelState | null;
}

export const GraphPanel: React.FC<GraphPanelProps> = ({ graphPanel }) => {
  const [selectedNode, setSelectedNode] = useState<UIGraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [zoom, setZoom] = useState<number>(1);

  const nodes = graphPanel?.nodes ?? [];
  const edges = graphPanel?.edges ?? [];

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const matchesType = filterType === 'all' || node.type === filterType;
      const matchesQuery =
        !searchQuery.trim() ||
        node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(node.metadata['path'] ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesQuery;
    });
  }, [nodes, filterType, searchQuery]);

  // Compute 2D coordinates arranged in an orbit/grid for the SVG canvas
  const positionedNodes = useMemo(() => {
    const width = 800;
    const height = 450;
    const count = filteredNodes.length;
    if (count === 0) return [];

    const radiusX = width * 0.38;
    const radiusY = height * 0.38;
    const centerX = width / 2;
    const centerY = height / 2;

    return filteredNodes.map((node, index) => {
      const angle = (index / count) * 2 * Math.PI;
      const x = centerX + radiusX * Math.cos(angle);
      const y = centerY + radiusY * Math.sin(angle);
      return { ...node, x, y };
    });
  }, [filteredNodes]);

  const nodePosMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of positionedNodes) {
      map.set(n.id, { x: n.x, y: n.y });
    }
    return map;
  }, [positionedNodes]);

  const visibleEdges = useMemo(() => {
    return edges
      .map((edge) => {
        const sourcePos = nodePosMap.get(edge.source);
        const targetPos = nodePosMap.get(edge.target);
        if (!sourcePos || !targetPos) return null;
        return {
          ...edge,
          x1: sourcePos.x,
          y1: sourcePos.y,
          x2: targetPos.x,
          y2: targetPos.y,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  }, [edges, nodePosMap]);

  const getNodeColor = (type: string) => {
    switch (type) {
      case 'file':
        return '#38bdf8'; // cyan-400
      case 'symbol':
        return '#818cf8'; // indigo-400
      case 'task':
        return '#34d399'; // emerald-400
      case 'decision':
        return '#fbbf24'; // amber-400
      case 'constraint':
        return '#f87171'; // red-400
      default:
        return '#94a3b8'; // slate-400
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Interactive Project Graph</h2>
          <span className="text-[11px] font-mono text-slate-500">
            ({nodes.length} nodes, {edges.length} edges)
          </span>
        </div>

        {/* Filter & Zoom Controls */}
        <div className="flex items-center gap-2 text-xs">
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 placeholder-slate-500 text-xs w-32 focus:outline-hidden focus:border-cyan-500"
          />

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter Nodes by Type"
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs"
          >
            <option value="all">All Types</option>
            <option value="file">Files</option>
            <option value="symbol">Symbols</option>
            <option value="task">Tasks</option>
            <option value="decision">Decisions</option>
            <option value="constraint">Constraints</option>
          </select>

          <div className="flex items-center bg-slate-950 border border-slate-800 rounded overflow-hidden">
            <button
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
              className="px-2 py-0.5 hover:bg-slate-800 text-slate-300 font-bold"
              title="Zoom out"
            >
              -
            </button>
            <span className="px-1.5 font-mono text-[10px] text-slate-400">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.2))}
              className="px-2 py-0.5 hover:bg-slate-800 text-slate-300 font-bold"
              title="Zoom in"
            >
              +
            </button>
            <button
              onClick={() => setZoom(1)}
              className="px-2 py-0.5 hover:bg-slate-800 text-slate-400 text-[10px]"
              title="Reset zoom"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Graph Canvas & Inspector Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* SVG Interactive Visualizer */}
        <div className="lg:col-span-3 bg-slate-950 border border-slate-800 rounded-xl overflow-hidden relative min-h-[380px] flex items-center justify-center">
          {positionedNodes.length > 0 ? (
            <svg
              viewBox="0 0 800 450"
              className="w-full h-full cursor-grab active:cursor-grabbing transition-transform duration-200"
              style={{ transform: `scale(${zoom})` }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="18"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                </marker>
              </defs>

              {/* Render Edges */}
              {visibleEdges.map((edge) => (
                <g key={edge.id}>
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke="#334155"
                    strokeWidth="1.5"
                    strokeDasharray={edge.type === 'implements' ? '4 3' : undefined}
                    markerEnd="url(#arrow)"
                  />
                  <text
                    x={(edge.x1 + edge.x2) / 2}
                    y={(edge.y1 + edge.y2) / 2 - 4}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="middle"
                  >
                    {edge.type}
                  </text>
                </g>
              ))}

              {/* Render Nodes */}
              {positionedNodes.map((node) => {
                const isSelected = selectedNode?.id === node.id;
                const color = getNodeColor(node.type);

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedNode(node)}
                    className="cursor-pointer group"
                  >
                    <circle
                      r={isSelected ? 18 : 14}
                      fill="#0f172a"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 2}
                      className="transition-all duration-200 group-hover:scale-110"
                    />
                    <circle r={isSelected ? 6 : 4} fill={color} />
                    <text
                      y="26"
                      fill="#cbd5e1"
                      fontSize="10"
                      fontFamily="system-ui"
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      textAnchor="middle"
                      className="select-none pointer-events-none"
                    >
                      {node.label.length > 20 ? `${node.label.slice(0, 18)}...` : node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="text-center text-xs text-slate-500 italic p-8">
              No graph nodes match current filters.
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-800 rounded-lg px-2.5 py-1.5 flex flex-wrap gap-3 text-[10px] font-medium backdrop-blur-xs">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#38bdf8]" /> File</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#818cf8]" /> Symbol</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#34d399]" /> Task</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#fbbf24]" /> Decision</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f87171]" /> Constraint</span>
          </div>
        </div>

        {/* Node Inspector Side Panel */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3 text-xs">
          <div className="border-b border-slate-800 pb-2 flex items-center justify-between">
            <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">Node Inspector</span>
            {selectedNode && (
              <span className="text-[10px] px-2 py-0.5 rounded capitalize" style={{ backgroundColor: `${getNodeColor(selectedNode.type)}20`, color: getNodeColor(selectedNode.type) }}>
                {selectedNode.type}
              </span>
            )}
          </div>

          {selectedNode ? (
            <div className="flex flex-col gap-2.5">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-mono">Label / Name</span>
                <span className="font-semibold text-slate-100 break-all">{selectedNode.label}</span>
              </div>

              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-mono">Node ID</span>
                <span className="font-mono text-[11px] text-cyan-400 break-all">{selectedNode.id}</span>
              </div>

              {Boolean(selectedNode.metadata['path']) && (
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-mono">File Path</span>
                  <span className="font-mono text-[11px] text-slate-300 break-all">{String(selectedNode.metadata['path'])}</span>
                </div>
              )}

              {Boolean(selectedNode.metadata['lineStart']) && (
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-mono">Location</span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Line {String(selectedNode.metadata['lineStart'])} - {String(selectedNode.metadata['lineEnd'])}
                  </span>
                </div>
              )}

              <div className="border-t border-slate-800/80 pt-2">
                <span className="text-slate-500 block text-[10px] uppercase font-mono mb-1">Metadata</span>
                <pre className="bg-slate-900 p-2 rounded text-[10px] font-mono text-slate-300 overflow-x-auto max-h-36">
                  {JSON.stringify(selectedNode.metadata, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 italic text-[11px]">
              Click on any node in the graph to inspect its properties, symbols, and connections.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
