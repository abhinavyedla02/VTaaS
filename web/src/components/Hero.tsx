import './Hero.css';

export default function Hero() {
  return (
    <section className="hero" id="hero">
      <a href="https://abhinavyedla.com" className="hero-back-link">
        ← Portfolio
      </a>
      <div className="hero-content">
        <h1 className="hero-title">VTaaS</h1>
        <p className="hero-subtitle">Video Transcode as a Service</p>
        <p className="hero-description">
          A distributed video transcoding pipeline built with{' '}
          <code>NestJS</code>, <code>AWS</code>, and <code>ffmpeg</code>.
        </p>
      </div>
    </section>
  );
}
