import { Component, type ReactNode } from 'react';
import { recordFailure, downloadDiagnostics } from './diagnostics';
export class PageBoundary extends Component<
  { children: ReactNode; scope?: 'app' | 'page' },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    recordFailure(this.props.scope === 'app' ? 'app-render' : 'page-render', error);
  }
  render() {
    if (this.state.failed)
      return (
        <section className={this.props.scope === 'app' ? 'card app-recovery' : 'card'} role="alert">
          <p>
            {this.props.scope === 'app'
              ? 'Не удалось открыть StudyHub. Обновите страницу и попробуйте снова.'
              : 'Не удалось открыть раздел. Проверьте соединение и обновите страницу.'}
          </p>
          <div className="card-actions">
            <button onClick={() => location.reload()}>Обновить страницу</button>
            <button onClick={downloadDiagnostics}>Скачать отчёт об ошибке</button>
          </div>
        </section>
      );
    return this.props.children;
  }
}
