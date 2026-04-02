import { useState } from 'react';
import Hero from './components/Hero';
import WhyThisExists from './components/WhyThisExists';
import DemoWidget from './components/DemoWidget';
import SystemDiagram from './components/SystemDiagram';
import AboutStack from './components/AboutStack';
import WhatsNext from './components/WhatsNext';
import type { DemoStatus, JobResponse } from './components/DemoWidget';

export default function App() {
  const [status, setStatus] = useState<DemoStatus>('idle');
  const [jobResponse, setJobResponse] = useState<JobResponse | null>(null);
  const [diagramStage, setDiagramStage] = useState(0);

  return (
    <div className="app">
      <main className="app-main">
        <Hero />
        <WhyThisExists />
        <DemoWidget
          status={status}
          setStatus={setStatus}
          jobResponse={jobResponse}
          setJobResponse={setJobResponse}
          setDiagramStage={setDiagramStage}
          diagramStage={diagramStage}
        />
        <SystemDiagram
          diagramStage={diagramStage}
          setDiagramStage={setDiagramStage}
          maxReachableStage={getMaxReachableStage(status, jobResponse?.status)}
          isFailed={status === 'failed'}
          isActive={status !== 'idle' && status !== 'error'}
          pulseNext={status === 'polling' || status === 'succeeded'}
        />
        <AboutStack />
        <WhatsNext />
      </main>

      <footer className="app-footer">
        <p>
          Built by{' '}
          <a
            href="https://github.com/abhinavyedla/VTaaS"
            target="_blank"
            rel="noopener noreferrer"
          >
            Abhinav Yedla
          </a>{' '}
          · Source on{' '}
          <a
            href="https://github.com/abhinavyedla/VTaaS"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}

/** Map the real pipeline state to the maximum diagram stage the user can advance to. */
function getMaxReachableStage(status: DemoStatus, jobStatus?: string): number {
  switch (status) {
    case 'idle':
    case 'error':
      return 0;
    case 'requesting':
      return 1;
    case 'uploading':
      return 2;
    case 'creating-job':
      return 3;
    case 'polling':
      if (jobStatus === 'PROCESSING') return 4;
      return 3; // PENDING
    case 'succeeded':
      return 6;
    case 'failed':
      return 6;
    default:
      return 0;
  }
}
