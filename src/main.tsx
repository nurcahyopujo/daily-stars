import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main>
      <header className="brand">
        <span className="star" aria-hidden="true">✦</span>
        <span>Daily Stars</span>
      </header>
      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">A little progress, every day</p>
        <h1 id="welcome-title">Small steps.<br />Bright days.</h1>
        <p className="intro">A place for your family’s routines, daily activities, and points.</p>
        <div className="empty-state">
          <span className="empty-star" aria-hidden="true">☆</span>
          <h2>Your family’s story starts here</h2>
          <p>Child profiles and routines are coming next.</p>
        </div>
      </section>
      <footer>Every effort counts.</footer>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The app root is missing.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
