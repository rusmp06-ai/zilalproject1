import { Component, type ReactNode } from 'react';
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="card" role="alert">
          <p>Не удалось открыть раздел. Проверьте соединение и обновите страницу.</p>
          <button onClick={() => location.reload()}>Обновить страницу</button>
        </section>
      );
    return this.props.children;
  }
}
