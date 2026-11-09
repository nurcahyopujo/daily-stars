import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ParentAccess } from './features/auth/ParentAccess';
import './styles.css';

function App() {
  return (
    <>
      <main><ParentAccess /></main>
      <footer>Every effort counts.</footer>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('The app root is missing.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
