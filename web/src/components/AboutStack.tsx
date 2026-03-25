import './AboutStack.css';

interface StackEntry {
  icon: string;
  name: string;
  description: string;
}

const STACK: StackEntry[] = [
  {
    icon: '🚀',
    name: 'NestJS + Fastify',
    description: 'Type-safe API framework with dependency injection and decorator-driven routing.',
  },
  {
    icon: '🗄️',
    name: 'Prisma + PostgreSQL',
    description: 'Schema-first ORM with migrations. Neon serverless Postgres in production.',
  },
  {
    icon: '☁️',
    name: 'AWS S3 + SQS',
    description: 'Presigned uploads to S3. SQS decouples job dispatch from processing.',
  },
  {
    icon: '🎬',
    name: 'ffmpeg',
    description: 'Industry-standard transcoding engine. Converts input video to 720p H.264.',
  },
  {
    icon: '🐳',
    name: 'ECS Fargate',
    description: 'Serverless container deployment. No EC2 instances to manage.',
  },
  {
    icon: '⚛️',
    name: 'React + Vite',
    description: 'Fast, modern frontend tooling with TypeScript and hot module replacement.',
  },
  {
    icon: '⚙️',
    name: 'GitHub Actions',
    description: 'CI pipeline: lint, typecheck, test, and Docker image builds on every PR.',
  },
];

export default function AboutStack() {
  return (
    <section className="stack section" id="stack">
      <p className="section-label">Technology</p>
      <h2 className="section-title">Built With</h2>

      <div className="stack-grid">
        {STACK.map((item) => (
          <div className="stack-item" key={item.name}>
            <div className="stack-item-icon">{item.icon}</div>
            <div className="stack-item-content">
              <div className="stack-item-name">{item.name}</div>
              <div className="stack-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
