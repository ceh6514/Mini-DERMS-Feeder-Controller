import '@testing-library/jest-dom';

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback([], this as unknown as IntersectionObserver);
  }
  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

// Provide a lightweight IntersectionObserver so scrolling logic doesn't break tests.
(globalThis as any).IntersectionObserver = MockIntersectionObserver;
