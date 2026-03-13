import { createContext, createSignal, For, useContext, type ParentComponent } from 'solid-js';

export type NotificationType = 'error' | 'warning' | 'info';

export interface Notification {
  id: number;
  type: NotificationType;
  message: string;
}

interface NotificationsContextValue {
  notify: (type: NotificationType, message: string) => void;
}

const NotificationsContext = createContext<NotificationsContextValue>();

let nextId = 0;

export const NotificationsProvider: ParentComponent = (props) => {
  const [notifications, setNotifications] = createSignal<Notification[]>([]);

  function notify(type: NotificationType, message: string) {
    const id = nextId++;
    setNotifications(prev => [...prev, { id, type, message }]);
    // Auto-dismiss after 6 seconds
    setTimeout(() => dismiss(id), 6000);
  }

  function dismiss(id: number) {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {props.children}
      <div class="toast-container" aria-live="assertive" role="alert">
        <For each={notifications()}>
          {(notification) => (
            <div class={`toast toast-${notification.type}`} onClick={() => dismiss(notification.id)}>
              <span class="toast-icon">
                {notification.type === 'error' ? '✕' : notification.type === 'warning' ? '⚠' : 'ℹ'}
              </span>
              <span class="toast-message">{notification.message}</span>
            </div>
          )}
        </For>
      </div>
    </NotificationsContext.Provider>
  );
};

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}
