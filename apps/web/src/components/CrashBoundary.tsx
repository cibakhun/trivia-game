import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/i18n.ts';
import { crashCause, crashReport, type CrashCause, type CrashEnv } from './crash-report.ts';

/**
 * Auffangschirm (ADR-061): Wirft ein Bauteil beim Zeichnen, nimmt React die ganze Seite vom
 * Bildschirm. Statt eines leeren Blatts steht dann hier, was geschehen ist, mit einer Meldung zum
 * Kopieren und „Neu laden“. Eine laufende Partie geht auf dem Server weiter (ARCHITECTURE §1.6);
 * nach dem Neuladen ist der Spieler wieder dabei.
 */

interface Crash {
  readonly cause: CrashCause;
  readonly report: string;
}

interface State {
  readonly crash: Crash | null;
  readonly copied: boolean;
}

function crashEnv(): CrashEnv {
  return {
    path: typeof window === 'undefined' ? '' : window.location.pathname,
    agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    at: new Date().toISOString(),
  };
}

function crashOf(error: unknown, componentStack: string | null): Crash {
  return { cause: crashCause(error), report: crashReport(error, componentStack, crashEnv()) };
}

export class CrashBoundary extends Component<{ readonly children: ReactNode }, State> {
  override state: State = { crash: null, copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { crash: crashOf(error, null) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Jetzt mit dem Weg durch die Bauteile; die Meldung steht auch in der Konsole des Browsers
    const crash = crashOf(error, info.componentStack ?? null);
    this.setState({ crash });
    console.error(crash.report);
  }

  private readonly copy = (): void => {
    const report = this.state.crash?.report;
    if (!report || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(report).then(
      () => this.setState({ copied: true }),
      // Kopieren verboten: Die Meldung steht markierbar auf dem Schirm
      () => undefined,
    );
  };

  override render(): ReactNode {
    const { crash, copied } = this.state;
    if (!crash) return this.props.children;
    const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
    return (
      <main className="crash" data-testid="crash-screen" data-cause={crash.cause} translate="no">
        <div className="crash-sheet" role="alert">
          <h1>{t('crash.title')}</h1>
          <p>{t('crash.text')}</p>
          {crash.cause === 'foreign-dom' ? (
            <p className="crash-cause" data-testid="crash-cause">
              {t('crash.causeForeign')}
            </p>
          ) : null}
          <div className="crash-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => window.location.reload()}
            >
              {t('crash.reload')}
            </button>
            {canCopy ? (
              <button type="button" className="button" onClick={this.copy}>
                {copied ? t('crash.copied') : t('crash.copy')}
              </button>
            ) : null}
          </div>
          <h2>{t('crash.reportTitle')}</h2>
          <pre className="crash-report" data-testid="crash-report" tabIndex={0}>
            {crash.report}
          </pre>
        </div>
      </main>
    );
  }
}
