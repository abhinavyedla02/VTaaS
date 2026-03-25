import './WhatsNext.css';

interface FutureItem {
  badge: string;
  title: string;
  description: string;
}

const FUTURE_ITEMS: FutureItem[] = [
  {
    badge: 'AI',
    title: 'AI Video Upscaling',
    description:
      'A Python worker running Real-ESRGAN on GPU-enabled ECS Fargate, consuming a separate SQS queue for AI-tier jobs.',
  },
  {
    badge: 'Auth',
    title: 'User Authentication',
    description:
      'Replace the submitter name form with Clerk or Auth0. Unlock per-user job history and access controls.',
  },
  {
    badge: 'Observability',
    title: 'Distributed Tracing',
    description:
      'Instrument the full API → SQS → Worker pipeline with OpenTelemetry for end-to-end trace visibility.',
  },
];

export default function WhatsNext() {
  return (
    <section className="next section" id="next">
      <p className="section-label">Roadmap</p>
      <h2 className="section-title">What I&apos;d Build Next</h2>

      <p className="next-intro">
        These features are intentionally out of scope for this version.
        They represent the natural next steps for this system and are designed
        to be conversation starters.
      </p>

      <div className="next-list">
        {FUTURE_ITEMS.map((item) => (
          <div className="next-item" key={item.badge}>
            <span className="next-item-badge">{item.badge}</span>
            <div className="next-item-content">
              <div className="next-item-title">{item.title}</div>
              <div className="next-item-desc">{item.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
