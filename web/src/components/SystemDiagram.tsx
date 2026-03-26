import './SystemDiagram.css';

/*
 * Two-row pipeline layout:
 *
 * Row 1 (processing):  Browser ──REST──> NestJS API ──enqueue──> SQS Queue ──poll──> ffmpeg Worker
 * Row 2 (storage):     S3 (inputs)                                                   S3 (outputs)
 *
 * Vertical arrows connect the rows. The presigned GET arrow runs along the bottom
 * from S3 outputs back to Browser.
 */

interface PipelineNode {
  id: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PipelineEdge {
  from: string;
  to: string;
  label: string;
  /** Optional label offset from the midpoint (positive = right/down) */
  labelDx?: number;
  labelDy?: number;
}

// Row 1: y=30, Row 2: y=170.  ~190px horizontal gap between nodes.
const NODES: PipelineNode[] = [
  // Row 1 — processing pipeline (left to right)
  { id: 'browser', label: 'Browser',       sublabel: 'React + Vite',   x: 30,  y: 30,  width: 120, height: 50 },
  { id: 'api',     label: 'NestJS API',    sublabel: 'Fastify',        x: 250, y: 30,  width: 120, height: 50 },
  { id: 'sqs',     label: 'SQS Queue',     sublabel: 'transcode-jobs', x: 470, y: 30,  width: 130, height: 50 },
  { id: 'worker',  label: 'ffmpeg Worker',  sublabel: 'ECS Fargate',    x: 700, y: 30,  width: 130, height: 50 },

  // Row 2 — storage (positioned below Browser and Worker)
  { id: 's3-in',   label: 'S3',            sublabel: 'vtaas-inputs',   x: 130, y: 170, width: 130, height: 50 },
  { id: 's3-out',  label: 'S3',            sublabel: 'vtaas-outputs',  x: 590, y: 170, width: 130, height: 50 },
];

const EDGES: PipelineEdge[] = [
  // Row 1 horizontal
  { from: 'browser', to: 'api',    label: 'REST' },
  { from: 'api',     to: 'sqs',    label: 'enqueue' },
  { from: 'sqs',     to: 'worker', label: 'poll' },

  // Vertical: Browser → S3 inputs (presigned PUT)
  { from: 'browser', to: 's3-in',  label: 'presigned PUT', labelDx: 6 },

  // Vertical: Worker → S3 inputs (GET input) and Worker → S3 outputs (PUT output)
  { from: 'worker',  to: 's3-in',  label: 'GET input',     labelDx: 0, labelDy: -4 },
  { from: 'worker',  to: 's3-out', label: 'PUT output',    labelDx: 6 },

  // Bottom return: S3 outputs → Browser (presigned GET)
  { from: 's3-out',  to: 'browser', label: 'presigned GET', labelDy: 14 },
];

/**
 * Map diagram stage (0-6) to the set of active node IDs.
 *
 * 0: idle — no highlights
 * 1: Browser + API (requesting/uploading)
 * 2: Browser + API + S3 inputs (uploaded to S3)
 * 3: All above + SQS Queue (job queued)
 * 4: SQS + Worker (transcoding)
 * 5: Worker + S3 outputs (output written)
 * 6: Worker + S3 outputs + Browser (complete — download ready)
 */
function getActiveNodesForStage(stage: number): Set<string> {
  switch (stage) {
    case 0: return new Set();
    case 1: return new Set(['browser', 'api']);
    case 2: return new Set(['browser', 'api', 's3-in']);
    case 3: return new Set(['browser', 'api', 's3-in', 'sqs']);
    case 4: return new Set(['sqs', 'worker']);
    case 5: return new Set(['worker', 's3-out']);
    case 6: return new Set(['worker', 's3-out', 'browser']);
    default: return new Set();
  }
}

const STAGE_LABELS: Record<number, string> = {
  1: 'Browser sends request to API',
  2: 'File uploaded to S3 via presigned URL',
  3: 'Job queued in SQS',
  4: 'Worker transcoding video',
  5: 'Output written to S3',
  6: 'Download ready in browser',
};

function getNodeCenter(node: PipelineNode): { cx: number; cy: number } {
  return { cx: node.x + node.width / 2, cy: node.y + node.height / 2 };
}

function getEdgePoint(
  node: PipelineNode,
  targetCx: number,
  targetCy: number,
): { x: number; y: number } {
  const { cx, cy } = getNodeCenter(node);
  const dx = targetCx - cx;
  const dy = targetCy - cy;
  const angle = Math.atan2(dy, dx);

  const halfW = node.width / 2;
  const halfH = node.height / 2;

  const tanAngle = Math.abs(Math.tan(angle));
  let ex: number;
  let ey: number;

  if (tanAngle <= halfH / halfW) {
    ex = dx > 0 ? halfW : -halfW;
    ey = ex * Math.tan(angle);
  } else {
    ey = dy > 0 ? halfH : -halfH;
    ex = ey / Math.tan(angle);
  }

  return { x: cx + ex, y: cy + ey };
}

interface SystemDiagramProps {
  diagramStage: number;
  setDiagramStage: React.Dispatch<React.SetStateAction<number>>;
  maxReachableStage: number;
  isFailed: boolean;
  isActive: boolean;
}

export default function SystemDiagram({
  diagramStage,
  setDiagramStage,
  maxReachableStage,
  isFailed,
  isActive,
}: SystemDiagramProps) {
  const nodeMap = new Map(NODES.map((n) => [n.id, n]));
  const activeNodes = isFailed
    ? new Set(['worker'])
    : getActiveNodesForStage(diagramStage);

  const canAdvance = !isFailed && diagramStage < maxReachableStage;
  const showButton = isActive && diagramStage < 6 && !isFailed;
  const stageLabel = STAGE_LABELS[diagramStage] ?? '';

  const handleNext = () => {
    if (canAdvance) {
      setDiagramStage((prev) => prev + 1);
    }
  };

  return (
    <section className="diagram section" id="diagram">
      <p className="section-label">Architecture</p>
      <h2 className="section-title">Pipeline Overview</h2>

      <div className="diagram-container">
        <svg
          className="diagram-svg"
          viewBox="0 0 880 250"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="VTaaS pipeline architecture diagram"
        >
          <defs>
            <marker
              id="arrowhead"
              viewBox="0 0 10 7"
              refX="10"
              refY="3.5"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#6a6a8a" />
            </marker>
            <marker
              id="arrowhead-active"
              viewBox="0 0 10 7"
              refX="10"
              refY="3.5"
              markerWidth="8"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-accent)" />
            </marker>
          </defs>

          {/* Edges (rendered first so nodes draw on top) */}
          {EDGES.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;

            const toCenter = getNodeCenter(toNode);
            const fromCenter = getNodeCenter(fromNode);
            const start = getEdgePoint(fromNode, toCenter.cx, toCenter.cy);
            const end = getEdgePoint(toNode, fromCenter.cx, fromCenter.cy);

            const midX = (start.x + end.x) / 2 + (edge.labelDx ?? 0);
            const midY = (start.y + end.y) / 2 + (edge.labelDy ?? 0);

            const labelWidth = edge.label.length * 6 + 12;
            const labelHeight = 16;

            const edgeActive = !isFailed && activeNodes.has(edge.from) && activeNodes.has(edge.to);
            const lineLength = Math.hypot(end.x - start.x, end.y - start.y);

            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  className={`diagram-arrow${edgeActive ? ' edge-active' : ''}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  markerEnd={edgeActive ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                  style={edgeActive ? { '--line-length': lineLength } as React.CSSProperties : undefined}
                />
                <rect
                  x={midX - labelWidth / 2}
                  y={midY - labelHeight / 2}
                  width={labelWidth}
                  height={labelHeight}
                  rx={3}
                  ry={3}
                  fill="#12121a"
                  fillOpacity={0.9}
                />
                <text className="diagram-arrow-label" x={midX} y={midY}>
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {NODES.map((node) => {
            const { cx, cy } = getNodeCenter(node);
            const isNodeActive = activeNodes.has(node.id);
            const isError = isFailed && node.id === 'worker';

            let rectClass = 'diagram-node-rect';
            if (isError) {
              rectClass += ' highlight-error';
            } else if (isNodeActive) {
              rectClass += ' highlight';
            }

            return (
              <g key={node.id}>
                <rect
                  className={rectClass}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={8}
                  ry={8}
                />
                <text className="diagram-node-label" x={cx} y={cy - 6}>
                  {node.label}
                </text>
                <text className="diagram-node-sublabel" x={cx} y={cy + 10}>
                  {node.sublabel}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Stage navigation */}
        {isActive && (
          <div className="diagram-controls">
            {stageLabel && (
              <span className="diagram-stage-label">{stageLabel}</span>
            )}
            {showButton && (
              <button
                className="diagram-next-btn"
                onClick={handleNext}
                disabled={!canAdvance}
              >
                Next →
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
