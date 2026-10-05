import { App } from '@app/App';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
