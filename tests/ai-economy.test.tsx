import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/?demo=1',
});
for (const key of [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'location',
  'history',
  'HTMLElement',
  'HTMLInputElement',
  'MutationObserver',
  'DOMParser',
  'FormData',
])
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
dom.window.confirm = () => true;
const React = await import('react');
const { render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { MaterialIntake } = await import('../src/MaterialIntake');
const { demoGateway, selectDemo, resetDemo } = await import('../src/demo');
const q = {
  user_daily: 5,
  project_daily: 20,
  rpm: 2,
  tpm: 12000,
  max_input: 8000,
  max_output: 2048,
  user_remaining: 5,
  project_remaining: 20,
  minute_remaining: 2,
  tokens_remaining: 12000,
  retry_after_seconds: 0,
  resets_at: '2026-10-17T00:00:00+06:00',
};
const result = {
  kind: 'lecture' as const,
  title: 'Cached title',
  course_id: 'g0c0',
  topic: '',
  description: 'Description',
  confidence: 'high' as const,
  reason: 'Known file',
  evidence: [],
  excerpted: false,
  cached: true,
  quota: q,
};
async function choose() {
  fireEvent.change(screen.getByLabelText('Документ для распознавания'), {
    target: { files: [new File(['Text'], 'lesson.txt', { type: 'text/plain' })] },
  });
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Распознать документ' })));
}
test('quota display and cached result do not turn title editing into another analysis', async () => {
  resetDemo();
  selectDemo('teacher');
  let analyses = 0;
  const api = {
    ...demoGateway,
    demo: false,
    materialAiQuota: async () => q,
    analyzeMaterial: async () => {
      analyses++;
      return result;
    },
  };
  render(React.createElement(MaterialIntake, { api }));
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить документ с ИИ' }));
    await screen.findByText(/Вам осталось 5 из 5/);
    await choose();
    fireEvent.click(screen.getByRole('checkbox', { name: /Разрешаю отправить/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Распознать документ' }));
    await screen.findByText(/Использован сохранённый результат/);
    fireEvent.change(screen.getByLabelText('Название документа'), {
      target: { value: 'Human correction' },
    });
    assert.equal(analyses, 1);
    assert.equal(
      (screen.getByLabelText('Название документа') as HTMLInputElement).value,
      'Human correction',
    );
  } finally {
    cleanup();
  }
});
test('zero quota and provider failure leave manual publication enabled', async () => {
  resetDemo();
  selectDemo('teacher');
  let publications = 0;
  const zero = { ...q, user_remaining: 0, project_remaining: 0 };
  const api = {
    ...demoGateway,
    demo: false,
    materialAiQuota: async () => zero,
    analyzeMaterial: async () => {
      throw Object.assign(Error('Квота исчерпана'), { quota: zero });
    },
    publishIntake: async () => {
      publications++;
      return 'published';
    },
  };
  render(React.createElement(MaterialIntake, { api }));
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить документ с ИИ' }));
    await screen.findByText(/Вам осталось 0 из 5/);
    await choose();
    fireEvent.click(screen.getByRole('checkbox', { name: /Разрешаю отправить/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Распознать документ' }));
    await screen.findByText('Квота исчерпана');
    fireEvent.change(screen.getByLabelText('Тип документа'), { target: { value: 'lecture' } });
    fireEvent.change(screen.getByLabelText('Дисциплина для публикации'), {
      target: { value: 'g0c0' },
    });
    fireEvent.change(screen.getByLabelText('Название документа'), {
      target: { value: 'Manual title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Утвердить и опубликовать' }));
    await screen.findByText('Материал опубликован. Оригинальный файл сохранён.');
    assert.equal(publications, 1);
  } finally {
    cleanup();
  }
});
