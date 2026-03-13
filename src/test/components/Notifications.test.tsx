import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { NotificationsProvider, useNotifications } from '../../notifications';

describe('NotificationsProvider', () => {
  function TestNotifier() {
    const { notify } = useNotifications();
    return (
      <div>
        <button data-testid="error-btn" onClick={() => notify('error', 'Something went wrong')}>Error</button>
        <button data-testid="warning-btn" onClick={() => notify('warning', 'Watch out')}>Warning</button>
        <button data-testid="info-btn" onClick={() => notify('info', 'FYI')}>Info</button>
      </div>
    );
  }

  it('renders error toast when notify is called', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    fireEvent.click(screen.getByTestId('error-btn'));
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong').closest('.toast')).toHaveClass('toast-error');
  });

  it('renders warning toast', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    fireEvent.click(screen.getByTestId('warning-btn'));
    expect(screen.getByText('Watch out')).toBeInTheDocument();
    expect(screen.getByText('Watch out').closest('.toast')).toHaveClass('toast-warning');
  });

  it('renders info toast', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    fireEvent.click(screen.getByTestId('info-btn'));
    expect(screen.getByText('FYI')).toBeInTheDocument();
    expect(screen.getByText('FYI').closest('.toast')).toHaveClass('toast-info');
  });

  it('dismisses toast on click', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    fireEvent.click(screen.getByTestId('error-btn'));
    const toast = screen.getByText('Something went wrong').closest('.toast')!;
    expect(toast).toBeInTheDocument();

    fireEvent.click(toast);
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('can show multiple toasts', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    fireEvent.click(screen.getByTestId('error-btn'));
    fireEvent.click(screen.getByTestId('warning-btn'));

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Watch out')).toBeInTheDocument();
  });

  it('has an aria-live region for accessibility', async () => {
    render(() => (
      <NotificationsProvider>
        <TestNotifier />
      </NotificationsProvider>
    ));

    const container = document.querySelector('.toast-container');
    expect(container).toHaveAttribute('aria-live', 'assertive');
    expect(container).toHaveAttribute('role', 'alert');
  });
});
