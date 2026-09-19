import { Task, HandoffReport, MemoryItem, GraphNode } from '../core/types.js';

export interface UIDashboardState {
  currentProject: string;
  activeTasks: Task[];
  recentHandoffs: HandoffReport[];
  pinnedDecisions: MemoryItem[];
  graphOverview: {
    totalNodes: number;
    totalEdges: number;
    sampleNodes: GraphNode[];
  };
}

export interface IUIBridge {
  getDashboardState(): Promise<UIDashboardState>;
}
