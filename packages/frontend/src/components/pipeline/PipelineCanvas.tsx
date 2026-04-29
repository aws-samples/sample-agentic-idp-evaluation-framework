import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  ConnectionLineType,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { PipelineDefinition } from '@idp/shared';
import DocumentInputNode from './nodes/DocumentInputNode';
import PageClassifierNode from './nodes/PageClassifierNode';
import CapabilityNode from './nodes/CapabilityNode';
import MethodNode from './nodes/MethodNode';
import AggregatorNode from './nodes/AggregatorNode';
import SequentialComposerNode from './nodes/SequentialComposerNode';
import OutputNode from './nodes/OutputNode';
import type { NodeStateInfo } from '../../hooks/usePipeline';

const nodeTypes = {
  'document-input': DocumentInputNode,
  'page-classifier': PageClassifierNode,
  capability: CapabilityNode,
  method: MethodNode,
  'sequential-composer': SequentialComposerNode,
  aggregator: AggregatorNode,
  'pipeline-output': OutputNode,
};

interface PipelineCanvasProps {
  pipeline: PipelineDefinition;
  nodeStates: Record<string, NodeStateInfo>;
  activeEdges: Set<string>;
  fileName?: string;
}

export default function PipelineCanvas({
  pipeline,
  nodeStates,
  activeEdges,
  fileName,
}: PipelineCanvasProps) {
  // Build initial nodes from pipeline definition
  const initialNodes: Node[] = useMemo(() => {
    return pipeline.nodes.filter((node) => node.position.x > -9000).map((node) => {
      const state = nodeStates[node.id]?.state || 'idle';
      const progress = nodeStates[node.id]?.progress;
      const metrics = nodeStates[node.id]?.metrics;

      return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          config: node.config,
          label: node.label,
          description: node.description,
          state,
          progress,
          metrics,
          fileName: node.type === 'document-input' ? fileName : undefined,
        },
        draggable: true,
      };
    });
  }, [pipeline.nodes, nodeStates, fileName]);

  const initialEdges: Edge[] = useMemo(() => {
    return pipeline.edges.map((edge) => {
      const isActive = activeEdges.has(edge.id);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: ConnectionLineType.SmoothStep,
        animated: isActive,
        style: {
          stroke: isActive ? '#0972d3' : '#b6bec9',
          strokeWidth: isActive ? 2.5 : 1.5,
        },
        labelStyle: { fontSize: 10, fill: '#5f6b7a' },
      };
    });
  }, [pipeline.edges, activeEdges]);

  // Local state for draggable nodes
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  // Sync when pipeline/states change
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [],
  );

  return (
    <div style={{ width: '100%', height: '500px', background: '#fafafa', borderRadius: '8px', border: '1px solid #e9ebed' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        panOnScroll
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: ConnectionLineType.SmoothStep,
        }}
      >
        <Background color="#e9ebed" gap={20} />
        <Controls style={{ bottom: 10, left: 10 }} />
      </ReactFlow>
    </div>
  );
}
