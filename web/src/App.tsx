import Hero from './components/Hero';
import WhyThisExists from './components/WhyThisExists';
import DemoWidget from './components/DemoWidget';
import SystemDiagram from './components/SystemDiagram';
import AboutStack from './components/AboutStack';
import WhatsNext from './components/WhatsNext';

export default function App() {
  return (
    <div className="app">
      <main className="app-main">
        <Hero />
        <WhyThisExists />
        <DemoWidget />
        <SystemDiagram />
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
