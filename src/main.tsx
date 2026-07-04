import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import { resolveFirebaseConfig, setRuntimeFirebaseConfig } from './services/runtimeFirebaseConfig';
import './index.css';

// Two-phase bootstrap: resolve the Firebase config BEFORE ever importing
// App.tsx, since App.tsx statically imports firebase.ts, which calls
// initializeApp() at module-evaluation time. Only importing App.tsx after
// resolution succeeds guarantees firebase.ts never runs without a config.
async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);

  const config = await resolveFirebaseConfig();
  if (!config) {
    const { default: DatabaseSetupView } = await import('./components/DatabaseSetupView.tsx');
    root.render(
      <StrictMode>
        <DatabaseSetupView />
      </StrictMode>,
    );
    return;
  }

  setRuntimeFirebaseConfig(config);
  const { default: App } = await import('./App.tsx');
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

bootstrap();
