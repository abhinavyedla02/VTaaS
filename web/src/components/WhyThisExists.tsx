import './WhyThisExists.css';

export default function WhyThisExists() {
  return (
    <section className="why section" id="why">
      <p className="section-label">Motivation</p>
      <h2 className="section-title">Why This Exists</h2>

      <div className="why-body">
        <p>
          Built to demonstrate a <strong>production-grade distributed pipeline</strong> end
          to end — not a tutorial CRUD app. Presigned uploads keep files off the API server.
          SQS decouples job dispatch from processing so the API stays responsive. The worker
          runs in its own ECS Fargate task with no inbound traffic.
          Every architectural decision has a reason — see the system diagram below.
        </p>
      </div>
    </section>
  );
}
